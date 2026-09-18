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
    // 场景：OpenCode Zen 端点 + 默认模型
    const captured = [];
    const $option = { endpoint: 'zen', apiKey: 'sk-oc' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: () => {} }, null);
    check('OpenCode Zen URL 正确', captured[0].url === 'https://opencode.ai/zen/v1/chat/completions', captured[0].url);
    check('Zen 默认模型 glm-5.3-flash', captured[0].body.model === 'glm-5.3-flash', captured[0].body.model);
    check('Zen GLM 发送 thinking disabled', captured[0].body.thinking && captured[0].body.thinking.type === 'disabled', captured[0].body.thinking);
}
{
    // 场景：OpenCode Go 订阅端点 + 自定义模型
    const captured = [];
    const $option = { endpoint: 'go', apiKey: 'sk-go', model: 'deepseek-v4.1-flash' };
    const $http = makeHttp(CHOICES_OK, captured);
    const t = makeTranslator($option, $http);
    await t.translate({ text: 'x', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: () => {} }, null);
    check('OpenCode Go URL 正确', captured[0].url === 'https://opencode.ai/zen/go/v1/chat/completions', captured[0].url);
    check('Go 自定义模型生效', captured[0].body.model === 'deepseek-v4.1-flash', captured[0].body.model);
    check('Go 非 GLM 模型不发送 thinking', !('thinking' in captured[0].body));
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
    // 场景：OpenCode Zen 端点（Zen 无 deepseek-v4.1-flash，视觉默认 glm-5.3-flash）
    const captured = [];
    const $option = { endpoint: 'zen', apiKey: 'sk-oc' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: () => {} }, null);
    check('OpenCode Zen URL 正确', captured[0].url === 'https://opencode.ai/zen/v1/chat/completions', captured[0].url);
    check('Zen 默认视觉模型 glm-5.3-flash', captured[0].body.model === 'glm-5.3-flash', captured[0].body.model);
    check('Zen GLM 视觉模型默认关闭 thinking', captured[0].body.thinking && captured[0].body.thinking.type === 'disabled', captured[0].body.thinking);
}
{
    // 场景：OpenCode Go 订阅端点（默认视觉模型 deepseek-v4.1-flash，支持图片输入）
    const captured = [];
    const $option = { endpoint: 'go', apiKey: 'sk-go' };
    const $http = makeHttp({ choices: [{ message: { content: 'txt' } }] }, captured);
    const o = makeOcr($option, $http);
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: () => {} }, null);
    check('OpenCode Go URL 正确', captured[0].url === 'https://opencode.ai/zen/go/v1/chat/completions', captured[0].url);
    check('Go 默认视觉模型 deepseek-v4.1-flash', captured[0].body.model === 'deepseek-v4.1-flash', captured[0].body.model);
    check('Go DeepSeek 视觉模型不发送 thinking', !('thinking' in captured[0].body));
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

// ============ baimiao 插件 ============
console.log('== bob baimiao ==');
function makeBaimiao($option, $http, $file, $data, $timer) {
    const script = readFileSync(path.join(here, 'baimiao', 'main.js'), 'utf8');
    const exportsObj = {};
    new Function('$option', '$http', '$file', '$data', '$timer', 'exports', script)($option, $http, $file, $data, $timer, exportsObj);
    check('baimiao: 入口函数已挂载到 exports', typeof exportsObj.ocr === 'function' && typeof exportsObj.supportLanguages === 'function', Object.keys(exportsObj));
    return { supportLanguages: exportsObj.supportLanguages, ocr: exportsObj.ocr };
}

const baimiaoSha1 = (() => {
    const script = readFileSync(path.join(here, 'baimiao', 'main.js'), 'utf8');
    return new Function(script + '\nreturn { sha1Hex: sha1Hex };')().sha1Hex;
})();
check('白描: 内置 SHA1("abc") 正确', baimiaoSha1('abc') === 'a9993e364706816aba3e25717850c26c9cd0d89d', baimiaoSha1('abc'));

function makeFile() {
    const files = {};
    return {
        files,
        exists: (p) => !!files[p],
        read: (p) => ({ toUTF8: () => files[p] }),
        write: (o) => { files[o.path] = o.data.toUTF8(); return true; }
    };
}
function makeData() {
    // 模拟 $data：appendData 原地拼接，可断言最终字节流的字段顺序
    function wrap(bytes) {
        return {
            __bytes: bytes,
            toUTF8: () => Buffer.from(bytes).toString('utf8'),
            appendData: (other) => { bytes.push(...other.__bytes); }
        };
    }
    return {
        fromUTF8: (s) => wrap(Array.from(Buffer.from(s, 'utf8'))),
        fromBase64: (b) => wrap(Array.from(Buffer.from(b, 'base64')))
    };
}
function makeTimer() {
    // 立即触发（测试中不等待真实间隔）
    return { schedule: (o) => { o.handler(); return 1; }, invalidate: () => {} };
}

function baimiaoRoute(step, url, opts) {
    const body = opts.body || {};
    if (url.endsWith('/user/login')) {
        step.loginCalls++;
        check('白描: 走账号登录且 type=mobile', body.username === '13818969223' && body.type === 'mobile', body);
        return { response: { statusCode: 200 }, data: { code: 1, data: { token: 'LOGIN_TOKEN', user: {} }, msg: 'success' } };
    }
    if (url.endsWith('/user/login/anonymous')) {
        step.loginCalls++;
        return { response: { statusCode: 200 }, data: { code: 1, data: { token: 'ANON_TOKEN', user: null }, msg: 'success' } };
    }
    if (url.endsWith('/perm/single')) {
        check('白描: perm/single 带 version=v2', body.version === 'v2' && body.mode === 'single', body);
        if (!opts.header['X-Auth-Token']) return { response: { statusCode: 200 }, data: { code: 0, msg: '请先登录' } };
        return { response: { statusCode: 200 }, data: { code: 1, data: { token: 'PERM_TOKEN', engine: 'plus' }, msg: 'success' } };
    }
    if (url.includes('/oss/sign')) {
        check('白描: oss/sign 携带 mime_type', url.includes('mime_type=image/png'), url);
        return { response: { statusCode: 200 }, data: { code: 1, data: { result: {
            host: 'https://oss.test', policy: 'POLICY', signature: 'SIG',
            x_oss_credential: 'CRED', x_oss_date: 'DATE', security_token: 'STK',
            file_key: 'upload/abc.png', content_types: ['image/png'] } }, msg: 'success' } };
    }
    if (url === 'https://oss.test') {
        const payload = opts.body && opts.body.__bytes;
        const ct = (opts.header && opts.header['Content-Type']) || '';
        const text = payload ? Buffer.from(payload).toString('utf8') : '';
        const keyIdx = text.indexOf('name="key"');
        const fileIdx = text.indexOf('name="file"');
        let found = false;
        if (payload) {
            outer: for (let i = 0; i <= payload.length - PNG_BYTES.length; i++) {
                for (let j = 0; j < PNG_BYTES.length; j++) {
                    if (payload[i + j] !== PNG_BYTES[j]) continue outer;
                }
                found = true;
                break;
            }
        }
        check('白描: OSS 上传为手工 multipart 字节流', Array.isArray(payload) && ct.startsWith('multipart/form-data; boundary=----SaladictBoundary'), ct);
        check('白描: key 字段存在于表单', keyIdx > -1, keyIdx);
        check('白描: key 字段在 file 字段之前（OSS 要求）', keyIdx > -1 && fileIdx > keyIdx, { keyIdx, fileIdx });
        check('白描: 上传字节体包含图片原始字节', found);
        const boundaryLine = ct.split('boundary=')[1] || '';
        check('白描: 以结束边界符收尾', text.trimEnd().endsWith('--' + boundaryLine + '--'), text.trimEnd().slice(-40));
        return { response: { statusCode: 200 }, data: '' };
    }
    if (url.includes('/ocr/image/plus') && !url.includes('/status')) {
        check('白描: 提交 payload 为 v2 最小格式', body.fileKey === 'upload/abc.png' && body.token === 'PERM_TOKEN' && body.dataUrl === undefined && body.total === 1, body);
        step.submittedHash = body.hash;
        return { response: { statusCode: 200 }, data: { code: 1, data: { hash: 'h1', jobStatusId: 'JOB/1+' }, msg: 'success' } };
    }
    if (url.includes('/status')) {
        check('白描: jobStatusId 已做 URL 编码', url.includes('JOB%2F1%2B'), url);
        step.pollCount = (step.pollCount || 0) + 1;
        if (step.pollCount === 1) return { response: { statusCode: 200 }, data: { code: 1, data: { isEnded: false }, msg: 'success' } };
        return { response: { statusCode: 200 }, data: { code: 1, data: { isEnded: true, ydResp: { words_result: [ { words: 'Hello' }, { words: 'World' } ] } }, msg: 'success' } };
    }
    return { response: { statusCode: 404 }, data: { msg: 'unexpected ' + url } };
}
function form2(body) { return !!body; }
function makeBaimiaoHttp(step) {
    return {
        request: async (options) => {
            step.calls.push(options);
            step.uuids.push(options.header['X-Auth-Uuid']);
            return baimiaoRoute(step, options.url, options);
        }
    };
}
{
    // 场景：账号模式，两次识别共享 $file 状态（第二次不再登录，uuid 稳定）
    const $file = makeFile();
    const step1 = { calls: [], uuids: [], loginCalls: 0 };
    const o1 = makeBaimiao({ username: '13818969223', password: 'pw' }, makeBaimiaoHttp(step1), $file, makeData(), makeTimer());
    const out1 = await new Promise((resolve) => {
        o1.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'zh-Hans', onCompletion: resolve }, null);
    });
    check('白描: 返回按行拆分的 texts', out1.result.texts.length === 2 && out1.result.texts[0].text === 'Hello' && out1.result.texts[1].text === 'World', out1);
    check('白描: 提交 hash 为 dataUrl 的 SHA1', step1.submittedHash === baimiaoSha1('data:image/png;base64,' + PNG_B64), step1.submittedHash);
    check('白描: 首次识别登录 1 次', step1.loginCalls === 1, step1.loginCalls);
    check('白描: 状态已持久化', !!$file.files['$sandbox/state.json'], Object.keys($file.files));
    // Bob 的 JavaScriptCore 可能没有 crypto.randomUUID，兜底生成必须符合标准 UUID v4 格式
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    check('白描: uuid 为标准带连字符 v4 格式', UUID_RE.test(step1.uuids[0]), step1.uuids[0]);

    const step2 = { calls: [], uuids: [], loginCalls: 0, pollCount: 0 };
    const o2 = makeBaimiao({ username: '13818969223', password: 'pw' }, makeBaimiaoHttp(step2), $file, makeData(), makeTimer());
    const out2 = await new Promise((resolve) => {
        o2.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'zh-Hans', onCompletion: resolve }, null);
    });
    check('白描: 第二次识别复用 token 不再登录', step2.loginCalls === 0, step2.loginCalls);
    check('白描: 两次识别 uuid 一致（不被识别为新设备）', step2.uuids[0] === step1.uuids[0], [step1.uuids[0], step2.uuids[0]]);
    check('白描: 第二次识别正常返回', out2.result.texts[0].text === 'Hello', out2);
}
{
    // 场景：匿名模式
    let anonymousCalled = false;
    const $http = {
        request: async (options) => {
            const body = options.body || {};
            if (options.url.endsWith('/user/login/anonymous')) {
                anonymousCalled = true;
                return { response: { statusCode: 200 }, data: { code: 1, data: { token: 'ANON', user: null }, msg: 'success' } };
            }
            if (options.url.endsWith('/perm/single')) {
                if (!options.header['X-Auth-Token']) return { response: { statusCode: 200 }, data: { code: 0, msg: '请先登录' } };
                return { response: { statusCode: 200 }, data: { code: 1, data: { token: 'PT', engine: 'plus' }, msg: 'success' } };
            }
            if (options.url.includes('/oss/sign')) return { response: { statusCode: 200 }, data: { code: 1, data: { result: { host: 'h', policy: 'p', signature: 's', x_oss_credential: 'c', x_oss_date: 'd', security_token: 'st', file_key: 'k' } }, msg: 'success' } };
            if (options.url === 'h') return { response: { statusCode: 200 }, data: '' };
            if (options.url.includes('/ocr/image/plus') && !options.url.includes('/status')) return { response: { statusCode: 200 }, data: { code: 1, data: { hash: 'x', jobStatusId: 'j' }, msg: 'success' } };
            if (options.url.includes('/status')) return { response: { statusCode: 200 }, data: { code: 1, data: { isEnded: true, ydResp: { words_result: [{ words: 'ok' }] } }, msg: 'success' } };
            return { response: { statusCode: 404 }, data: {} };
        }
    };
    const o = makeBaimiao({}, $http, makeFile(), makeData(), makeTimer());
    const out = await new Promise((resolve) => {
        o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: resolve }, null);
    });
    check('白描: 匿名模式可用', anonymousCalled && out.result.texts[0].text === 'ok', out);
}
{
    // 场景：登录失败抛出服务端 msg
    let err = null;
    const $http = {
        request: async (options) => {
            if (options.url.endsWith('/perm/single')) return { response: { statusCode: 200 }, data: { code: 0, msg: '请先登录' } };
            if (options.url.endsWith('/user/login')) return { response: { statusCode: 200 }, data: { code: 0, msg: '密码错误' } };
            return { response: { statusCode: 404 }, data: {} };
        }
    };
    const o = makeBaimiao({ username: 'a@b.c', password: 'x' }, $http, makeFile(), makeData(), makeTimer());
    await o.ocr({ image: { toBase64: () => PNG_B64 }, detectFrom: 'en', onCompletion: (o) => (err = o) }, null);
    check('白描: 登录失败抛出原因', err && err.error && err.error.type === 'secretKey' && err.error.message.includes('密码错误'), err);
}

console.log('\n结果: ' + passed + ' 通过, ' + failures + ' 失败');
process.exit(failures > 0 ? 1 : 0);

