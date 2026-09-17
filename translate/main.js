// DeepSeek / GLM 翻译插件（Bob 版）
// Bob 插件为普通脚本，需定义 supportLanguages() 与 translate(query, completion)
// 配置通过 $option 读取：endpoint / customEndpoint / apiKey / model

var ENDPOINTS = {
    deepseek: 'https://api.deepseek.com',
    zai: 'https://api.z.ai/api/paas/v4',
    zai_coding: 'https://api.z.ai/api/coding/paas/v4',
    bigmodel: 'https://open.bigmodel.cn/api/paas/v4',
    bigmodel_coding: 'https://open.bigmodel.cn/api/coding/paas/v4'
};

// 配置界面的下拉菜单默认只"显示"第一项，用户不点选不会写入配置，
// 因此所有配置项都在代码里兜底默认值
var DEFAULT_ENDPOINT = 'deepseek';

// Bob 语言代码 -> 提示词用语言名
var LANGUAGE_NAMES = {
    'zh-Hans': 'Simplified Chinese',
    'zh-Hant': 'Traditional Chinese',
    'yue': 'Cantonese',
    'wyw': 'Classical Chinese',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'it': 'Italian',
    'ru': 'Russian',
    'pt-pt': 'Portuguese',
    'pt-br': 'Brazilian Portuguese',
    'tr': 'Turkish',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'th': 'Thai',
    'ms': 'Malay',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'fa': 'Persian',
    'sv': 'Swedish',
    'pl': 'Polish',
    'nl': 'Dutch',
    'uk': 'Ukrainian',
    'he': 'Hebrew',
    'km': 'Khmer',
    'nb': 'Norwegian Bokmål',
    'nn': 'Norwegian Nynorsk',
    'mn': 'Mongolian'
};

function supportLanguages() {
    var codes = [];
    for (var code in LANGUAGE_NAMES) codes.push(code);
    return codes;
}

function isCustomEndpoint() {
    return ($option.customEndpoint || '').trim().length > 0 || $option.endpoint === 'custom';
}

function resolveEndpoint() {
    return $option.endpoint || DEFAULT_ENDPOINT;
}

function resolveBaseUrl() {
    var custom = ($option.customEndpoint || '').trim();
    if (custom) return custom;
    var preset = ENDPOINTS[resolveEndpoint()];
    if (preset) return preset;
    throw errorObj('param', '接口地址配置无效（' + resolveEndpoint() + '）：请重新选择接口');
}

function buildChatUrl(baseUrl) {
    var base = String(baseUrl).trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    return base + '/chat/completions';
}

function resolveModel() {
    var model = ($option.model || '').trim();
    if (model) return model;
    if (isCustomEndpoint()) throw errorObj('param', '使用自定义接口时请填写模型名称');
    if (resolveEndpoint() === 'deepseek') return 'deepseek-chat';
    return 'glm-4.7';
}

function errorObj(type, message) {
    return { type: type, message: message };
}

async function translate(query, completion) {
    function done(obj) {
        if (query && query.onCompletion) query.onCompletion(obj);
        else if (completion) completion(obj);
    }

    try {
        var apiKey = ($option.apiKey || '').trim();
        var custom = isCustomEndpoint();
        if (!apiKey && !custom) {
            throw errorObj('secretKey', 'API Key 未配置：请在插件设置中填写 API Key');
        }
        var headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

        var model = resolveModel();
        var target = LANGUAGE_NAMES[query.detectTo] || query.detectTo;
        var source = LANGUAGE_NAMES[query.detectFrom] || query.detectFrom;

        var instruction =
            'You are a professional translation engine. Translate the text naturally, accurately and fluently, ' +
            'like a professional human translator. Output ONLY the translation, without any explanation or extra content.';
        var userContent;
        if (source && source !== 'auto') {
            userContent = 'Translate from ' + source + ' into ' + target + ':\n' + query.text;
        } else {
            userContent = 'Translate into ' + target + ':\n' + query.text;
        }

        var body = {
            model: model,
            stream: false,
            messages: [
                { role: 'system', content: instruction },
                { role: 'user', content: userContent }
            ]
        };
        // GLM 系列关闭深度思考，翻译更快；DeepSeek 等其他模型不发送该参数
        if (/^glm/i.test(model)) body.thinking = { type: 'disabled' };

        var resp = await $http.request({
            method: 'POST',
            url: buildChatUrl(resolveBaseUrl()),
            header: headers,
            body: body
        });

        var statusCode = resp && resp.response && resp.response.statusCode;
        if (resp && resp.error) {
            throw errorObj('network', 'Http Request Error: ' + (resp.error.message || JSON.stringify(resp.error)).slice(0, 300));
        }
        if (statusCode !== 200) {
            throw errorObj('network', 'Http Request Error\nHttp Status: ' + (statusCode || '未知') + '\n' +
                String(JSON.stringify(resp && resp.data)).slice(0, 400));
        }

        var data = resp.data;
        var choice = data && data.choices && data.choices[0];
        var message = choice && choice.message;
        var content = '';
        if (message && typeof message.content === 'string') {
            content = message.content;
        } else if (message && Array.isArray(message.content)) {
            content = message.content.map(function (p) {
                return p && typeof p.text === 'string' ? p.text : '';
            }).join('');
        }
        content = (content || '').trim();
        if (!content && message && message.reasoning_content) {
            content = String(message.reasoning_content).trim();
        }
        if (!content) {
            throw errorObj('api', '接口未返回内容：' + String(JSON.stringify(data)).slice(0, 400));
        }
        var text = content.replace(/^"+|"+$/g, '').trim();

        done({
            result: {
                from: query.detectFrom,
                to: query.detectTo,
                toParagraphs: [text]
            }
        });
    } catch (e) {
        var err = (e && e.type && e.message) ? e : errorObj('unknown', String(e && e.message ? e.message : e));
        done({ error: err });
    }
}

// Bob 以 CommonJS 方式加载插件，入口函数必须挂到 exports 上才能被识别
if (typeof exports !== 'undefined' && exports) {
    var __entry = typeof translate === 'function' ? 'translate' : (typeof ocr === 'function' ? 'ocr' : null);
    if (__entry === 'translate') exports.translate = translate;
    if (__entry === 'ocr') exports.ocr = ocr;
    exports.supportLanguages = supportLanguages;
}
