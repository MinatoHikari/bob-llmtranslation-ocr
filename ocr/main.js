// DeepSeek / GLM 文字识别（OCR）插件（Bob 版）
// Bob 插件为普通脚本，需定义 supportLanguages() 与 ocr(query, completion)
// 配置通过 $option 读取：endpoint / customEndpoint / apiKey / model / thinking / ocrPrompt
//
// 注意：DeepSeek 要求图片只出现在 user 消息中

var ENDPOINTS = {
    deepseek: 'https://api.deepseek.com',
    zai: 'https://api.z.ai/api/paas/v4',
    zai_coding: 'https://api.z.ai/api/coding/paas/v4',
    bigmodel: 'https://open.bigmodel.cn/api/paas/v4',
    bigmodel_coding: 'https://open.bigmodel.cn/api/coding/paas/v4'
};

var DEFAULT_ENDPOINT = 'zai';

// Bob 语言代码 -> 语言名（提示词用；识别本身按图自动识别语言）
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

// 提示词显式禁止翻译与附加标签；Free OCR. 为 GLM 视觉模型的训练格式
var DEFAULT_OCR_PROMPT =
    'Free OCR. Recognize ALL text in the image and output it verbatim in the original language, keeping the original line breaks. ' +
    'Do NOT translate. Do NOT add any headings, labels (such as OCR Result or Translation), markdown formatting or explanations. ' +
    'Output only the recognized text.';

// 清洗模型自行附加的内容：剥离 OCR Result/识别结果 标签前缀；
// 出现 Translation/翻译 小节时丢弃该行及之后全部内容（模型自作主张的翻译）
function sanitizeOcrText(text) {
    var lines = String(text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].replace(/\s+$/, '');
        if (/^(\*{1,2}|_{1,2})?\s*(translation|译文|翻译)\s*(\*{1,2}|_{1,2})?\s*[:：]\s*(\*{1,2}|_{1,2})?\s*/i.test(trimmed)) {
            break;
        }
        var label = trimmed.match(/^(\*{1,2}|_{1,2})?\s*(ocr\s*result|ocr结果|识别结果)\s*(\*{1,2}|_{1,2})?\s*[:：]\s*(\*{1,2}|_{1,2})?\s*/i);
        if (label) {
            var rest = trimmed.slice(label[0].length).trim();
            if (rest) out.push(rest);
            continue;
        }
        out.push(lines[i]);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
    if (isCustomEndpoint()) throw errorObj('param', '使用自定义接口时请填写模型名称（如 DeepSeek-OCR 填 deepseek-ai/DeepSeek-OCR-GGUF）');
    if (resolveEndpoint() === 'deepseek') return 'deepseek-flash';
    return 'glm-4.6v';
}

function errorObj(type, message) {
    return { type: type, message: message };
}

async function ocr(query, completion) {
    function done(obj) {
        if (query && query.onCompletion) query.onCompletion(obj);
        else if (completion) completion(obj);
    }

    try {
        if (!query || !query.image) throw errorObj('param', '未收到图片数据');

        var apiKey = ($option.apiKey || '').trim();
        var custom = isCustomEndpoint();
        if (!apiKey && !custom) {
            throw errorObj('secretKey', 'API Key 未配置：请在插件设置中填写 API Key');
        }
        var headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

        var model = resolveModel();

        var customPrompt = ($option.ocrPrompt || '').trim();
        var prompt = customPrompt || DEFAULT_OCR_PROMPT;

        var base64 = query.image.toBase64();
        var dataUrl = 'data:image/png;base64,' + base64;

        var body = {
            model: model,
            stream: false,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: dataUrl } },
                        { type: 'text', text: prompt }
                    ]
                }
            ]
        };

        // GLM 系列支持 thinking 开关；默认关闭以加快识别，auto 则不发送该参数
        var thinking = ($option.thinking || 'disabled').trim();
        if (/^glm/i.test(model) && thinking !== 'auto') {
            body.thinking = { type: thinking === 'enabled' ? 'enabled' : 'disabled' };
        }

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
        var text = sanitizeOcrText(content.replace(/^"+|"+$/g, '').trim());

        var texts = text.split('\n').map(function (line) {
            return { text: line };
        });
        done({
            result: {
                from: query.detectFrom,
                texts: texts
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
