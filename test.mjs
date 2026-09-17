// Bob 插件冒烟测试：mock $option / $http，验证请求构造与结果解析
// 运行：bun bob/test.mjs 或 node bob/test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failures = 0;

function check(name, cond, extra) {
    if (cond) {
        passed++;
        console.log('  ✓ ' + name);
    } else {
        failures++;
        console.error('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : ''));
    }
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Array.from(Buffer.from(PNG_B64, 'base64'));

// 按 Bob 的 CommonJS 方式加载：注入 exports 对象，入口函数必须挂到 exports 上才能被识别
function loadWithExports(dir, args) {
    const script = readFileSync(path.join(here, dir, 'main.js'), 'utf8');
    const exportsObj = {};
    new Function('$option, $http, exports', script)(args[0], args[1], exportsObj);
    return exportsObj;
}

function makeTranslator($option, $http) {
    const exportsObj = loadWithExports('translate', [$option, $http]);
    check('translate: 入口函数已挂载到 exports', typeof exportsObj.translate === 'function' && typeof exportsObj.supportLanguages === 'function', Object.keys(exportsObj));
    return { supportLanguages: exportsObj.supportLanguages, translate: exportsObj.translate };
}

function makeOcr($option, $http) {
    const exportsObj = loadWithExports('ocr', [$option, $http]);
    check('ocr: 入口函数已挂载到 exports', typeof exportsObj.ocr === 'function' && typeof exportsObj.supportLanguages === 'function', Object.keys(exportsObj));
    return { supportLanguages: exportsObj.supportLanguages, ocr: exportsObj.ocr };
}

function makeHttp(data, capture) {
    return {
        request: async (options) => {
            if (capture) capture.push(options);
            if (typeof data === 'function') return data(options);
            return { response: { statusCode: 200 }, data };
        }
    };
}

const CHOICES_OK = { choices: [{ message: { content: '你好，世界' } }] };

// ============ translate 插件 ============
console.log('== bob translate ==');
{
    // supportLanguages 不依赖配置
    const t = makeTranslator({}, makeHttp({}, []));
    const langs = t.supportLanguages();
    check('supportLanguages 含 zh-Hans/en/ja', langs.includes('zh-Hans') && langs.includes('en') && langs.includes('ja'));
}
{
    // 场景：Z.ai 端点 + 默认模型，走 query.onCompletion
    const captured = [];
    const $option = { endpoint: 'zai', apiKey: 'sk-zai' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    const out = await new Promise((resolve) => {
        t.translate({ text: 'hello', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: resolve }, null);
    });
    const req = captured[0];
    check('Z.ai URL 正确', req.url === 'https://api.z.ai/api/paas/v4/chat/completions', req.url);
    check('默认模型 glm-4.7', req.body.model === 'glm-4.7', req.body.model);
    check('GLM 发送 thinking disabled', req.body.thinking && req.body.thinking.type === 'disabled', req.body.thinking);
    check('Bearer 认证头', req.header.Authorization === 'Bearer sk-zai');
    check('目标语言映射英文名', req.body.messages[1].content.includes('Simplified Chinese'), req.body.messages[1].content);
    check('onCompletion 返回 toParagraphs', out.result && out.result.toParagraphs[0] === '你好，世界', out);
    check('result.from/to 为 Bob 语言代码', out.result.from === 'en' && out.result.to === 'zh-Hans', out.result);
}
{
    // 场景：DeepSeek 端点 + 自定义模型，走 completion 参数回调
    const captured = [];
    const $option = { endpoint: 'deepseek', apiKey: 'sk-ds', model: 'deepseek-reasoner' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    const out = await new Promise((resolve) => {
        t.translate({ text: '你好', detectFrom: 'zh-Hans', detectTo: 'en' }, resolve);
    });
    const req = captured[0];
    check('DeepSeek URL 正确', req.url === 'https://api.deepseek.com/chat/completions', req.url);
    check('自定义模型生效', req.body.model === 'deepseek-reasoner', req.body.model);
    check('非 GLM 不发送 thinking', !('thinking' in req.body));
    check('completion 参数回调可用', out.result && out.result.toParagraphs[0] === '你好，世界', out);
    check('双语提示词', req.body.messages[1].content.startsWith('Translate from Simplified Chinese into English:'), req.body.messages[1].content);
}
{
    // 场景：智谱中国站 Coding Plan 端点
    const captured = [];
    const $option = { endpoint: 'bigmodel_coding', apiKey: 'k' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    const out = await new Promise((resolve) => {
        t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans' }, resolve);
    });
    check('智谱中国站 Coding Plan URL', captured[0].url === 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', captured[0].url);
    check('首尾引号被去除', out.result.toParagraphs[0] === '你好，世界', out.result);
}
{
    // 场景：自定义端点优先
    const captured = [];
    const $option = { endpoint: 'zai', apiKey: 'k', customEndpoint: 'http://127.0.0.1:8080/v1', model: 'test' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: () => {} }, null);
    check('自定义端点优先', captured[0].url === 'http://127.0.0.1:8080/v1/chat/completions', captured[0].url);
}
{
    // 场景：自定义接口必须填模型
    let err = null;
    const $option = { endpoint: 'custom', customEndpoint: 'http://a.b/v1' };
    const $http = makeHttp(CHOICES_OK, []);
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: (o) => (err = o) }, null);
    check('自定义接口必须填模型', err && err.error && err.error.type === 'param' && err.error.message.includes('模型名称'), err);
}
{
    // 场景：缺 API Key → secretKey
    let err = null;
    const $option = { endpoint: 'zai' };
    const $http = makeHttp(CHOICES_OK, []);
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: (o) => (err = o) }, null);
    check('缺 API Key 报 secretKey', err && err.error && err.error.type === 'secretKey', err);
}
{
    // 场景：HTTP 401 → network
    let err = null;
    const $option = { endpoint: 'zai', apiKey: 'k' };
    const $http = { request: async () => ({ response: { statusCode: 401 }, data: { error: { message: 'invalid key' } } }) };
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: (o) => (err = o) }, null);
    check('HTTP 401 报 network', err && err.error && err.error.type === 'network' && err.error.message.includes('401'), err);
}
{
    // 场景：首尾引号去除
    const $option = { endpoint: 'zai', apiKey: 'k' };
    const $http = makeHttp({ choices: [{ message: { content: '"清理后"' } }] }, []);
    const t = makeTranslator($option, $http);
    const out = await new Promise((resolve) => t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans' }, resolve));
    check('首尾引号被去除', out.result.toParagraphs[0] === '清理后', out.result);
}

// ============ ocr 插件 ============
console.log('== bob ocr ==');
{
    const captured = [];
    const $option = { endpoint: 'zai', apiKey: 'sk-zai' };
    const $http = makeHttp({ choices: [{ message: { content: '第一行\n第二行' } }] }, captured);
    const o = makeOcr($option, $http);
    check('ocr supportLanguages 含 zh-Hans', o.supportLanguages().includes('zh-Hans'));
    const image = { toBase64: () => PNG_B64 };
    const out = await new Promise((resolve) => o.ocr({ image, detectFrom: 'en', onCompletion: resolve }, null));
    const req = captured[0];
    const content = req.body.messages[0].content;
    check('Z.ai URL 正确', req.url === 'https://api.z.ai/api/paas/v4/chat/completions', req.url);
    check('默认模型 glm-4.6v', req.body.model === 'glm-4.6v', req.body.model);
    check('消息角色为 user（DeepSeek 要求）', req.body.messages[0].role === 'user');
    check('图片为 data URL base64', content[0].image_url.url === 'data:image/png;base64,' + PNG_B64);
    check('默认提示词禁止翻译并含 Free OCR.', content[1].text.includes('Free OCR.') && content[1].text.includes('Do NOT translate'), content[1].text);
    check('GLM 默认关闭 thinking', req.body.thinking && req.body.thinking.type === 'disabled', req.body.thinking);
    check('识别结果按行拆分为 texts', out.result.texts.length === 2 && out.result.texts[0].text === '第一行' && out.result.texts[1].text === '第二行', out.result);
    check('result.from 为 detectFrom', out.result.from === 'en', out.result);
}
{
    const captured = [];
    const $option = { endpoint: 'deepseek', apiKey: 'sk-ds' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: () => {} }, null);
    const p = captured[0].body;
    check('DeepSeek 默认视觉模型 deepseek-flash', p.model === 'deepseek-flash', p.model);
    check('DeepSeek 不发送 thinking', !('thinking' in p));
}
{
    const captured = [];
    const $option = { endpoint: 'bigmodel_coding', apiKey: 'k' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: () => {} }, null);
    check('智谱中国站 Coding Plan URL', captured[0].url === 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', captured[0].url);
}
{
    const captured = [];
    const $option = { endpoint: 'bigmodel', apiKey: 'k', thinking: 'enabled' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'ja', onCompletion: () => {} }, null);
    check('thinking 开启生效', captured[0].body.thinking.type === 'enabled', captured[0].body.thinking);
}
{
    const captured = [];
    const $option = { endpoint: 'bigmodel', apiKey: 'k', thinking: 'auto' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'ja', onCompletion: () => {} }, null);
    check('thinking=auto 不发送参数', !('thinking' in captured[0].body));
}
{
    // 场景：自定义提示词原样使用
    const captured = [];
    const $option = { endpoint: 'zai', apiKey: 'k', ocrPrompt: '只输出数字' };
    const $http = makeHttp({ choices: [{ message: { content: '42' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: () => {} }, null);
    check('自定义提示词生效', captured[0].body.messages[0].content[1].text === '只输出数字', captured[0].body.messages[0].content[1].text);
}
{
    // 场景：本地服务必须填模型名
    let err = null;
    const $option = { endpoint: 'custom', customEndpoint: 'http://127.0.0.1:8080/v1' };
    const $http = makeHttp({ choices: [{}] }, []);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: (o) => (err = o) }, null);
    check('本地服务必须填模型名', err && err.error && err.error.type === 'param' && err.error.message.includes('模型名称'), err);
}
{
    // 场景：缺 API Key 报 secretKey
    let err = null;
    const $option = { endpoint: 'zai' };
    const $http = makeHttp({ choices: [{}] }, []);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: (o) => (err = o) }, null);
    check('缺 API Key 报 secretKey', err && err.error && err.error.type === 'secretKey', err);
}

{
    // 场景：模型自作主张附加 OCR Result/Translation 标签 → 清洗
    const $option = { endpoint: 'deepseek', apiKey: 'sk-ds' };
    const $http = makeHttp({ choices: [{ message: { content: `**OCR Result:** 夜深啦,别忘了照顾好自己哦\n**Translation:** "It's late at night, don't forget to take good care of yourself~` } }] }, []);
    const o = makeOcr($option, $http);
    const out = await new Promise((resolve) => o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'zh-Hans', onCompletion: resolve }, null));
    check('清洗掉模型附加的标签与翻译', out.result.texts.length === 1 && out.result.texts[0].text === '夜深啦,别忘了照顾好自己哦', out.result);
}


console.log('\n结果: ' + passed + ' 通过, ' + failures + ' 失败');
process.exit(failures > 0 ? 1 : 0);
