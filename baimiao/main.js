// 白描 OCR 识别插件（Bob 版）
// ============================================================
// 白描网页版接口为 v2 流程（旧版直接提交 dataUrl 已被服务端拒绝）：
//   1. 登录：POST /api/user/login（账号）或 /api/user/login/anonymous（匿名）
//   2. 申请额度：POST /api/perm/single {mode:'single', version:'v2'}
//   3. 上传图片：GET /api/oss/sign 获取阿里云 OSS 签名
//      -> 手工构造 multipart（file 字段必须在最后）POST 到 host 拿 file_key
//   4. 提交识别：POST /api/ocr/image/{engine} 携带 fileKey（不再携带 dataUrl）
//   5. 轮询：GET /api/ocr/image/{engine}/status 直到 isEnded，解析 ydResp.words_result
//
// 设备标识（X-Auth-Uuid）与登录 token 通过 $file 持久化到 $sandbox/state.json：
//   uuid 稳定避免每次识别触发"新设备登录"，token 复用减少重复登录。
//
// 配置项（info.json options）：username / password（均可选，不填走匿名模式）

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

var BAIMIAO_API = 'https://web.baimiaoapp.com/api';
var STATE_PATH = '$sandbox/state.json';
var UPLOAD_MIME = 'image/png';
var CRLF = String.fromCharCode(13, 10);
var POLL_INTERVAL_SEC = 0.5;
var POLL_MAX = 120; // 最长等待约 60 秒

var AUTH_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://web.baimiaoapp.com',
    'Referer': 'https://web.baimiaoapp.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

// Bob 语言代码列表（识别本身按图自动识别语言，此处仅声明支持范围）
var SUPPORTED_LANGUAGES = [
    'auto', 'zh-Hans', 'zh-Hant', 'yue', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it',
    'ru', 'pt-pt', 'pt-br', 'tr', 'vi', 'id', 'th', 'ms', 'ar', 'hi'
];

// ------------------------------------------------------------
// 通用工具
// ------------------------------------------------------------

// 纯 JS SHA1（输出十六进制），用于计算图片 dataUrl 的哈希
function sha1Hex(str) {
    function rol(n, b) { return (n << b) | (n >>> (32 - b)); }
    function toUtf8(s) {
        try {
            return unescape(encodeURIComponent(s));
        } catch (e) {
            return s;
        }
    }
    var msg = toUtf8(str);
    var ml = msg.length;
    var words = [];
    for (var i = 0; i < ml; i++) {
        words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) << (24 - (i % 4) * 8));
    }
    words[ml >> 2] = (words[ml >> 2] || 0) | (0x80 << (24 - (ml % 4) * 8));
    words[(((ml + 8) >> 6) + 1) * 16 - 1] = ml * 8;
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    for (var k = 0; k < words.length; k += 16) {
        var w = [];
        for (var j = 0; j < 16; j++) w[j] = words[k + j] || 0;
        for (var j2 = 16; j2 < 80; j2++) {
            w[j2] = rol(w[j2 - 3] ^ w[j2 - 8] ^ w[j2 - 14] ^ w[j2 - 16], 1);
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
        for (var j3 = 0; j3 < 80; j3++) {
            var f, t;
            if (j3 < 20) { f = (b & c) | (~b & d); t = 0x5a827999; }
            else if (j3 < 40) { f = b ^ c ^ d; t = 0x6ed9eba1; }
            else if (j3 < 60) { f = (b & c) | (b & d) | (c & d); t = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; t = 0xca62c1d6; }
            var tmp = (rol(a, 5) + f + e + t + w[j3]) | 0;
            e = d; d = c; c = rol(b, 30); b = a; a = tmp;
        }
        H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0, (H[4] + e) | 0];
    }
    var out = '';
    for (var h = 0; h < 5; h++) {
        out += ('00000000' + ((H[h] >>> 0).toString(16))).slice(-8);
    }
    return out;
}

// 标准 UUID v4（带连字符）——白描服务端会校验格式，不接受无连字符的裸 hex
function newUuid() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* 忽略 */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.floor(Math.random() * 16);
        var v = c === 'x' ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
    });
}

function sleep(sec) {
    return new Promise(function (resolve) {
        try {
            $timer.schedule({ interval: sec, repeats: false, handler: resolve });
        } catch (e) {
            resolve();
        }
    });
}

function errorObj(type, message) {
    return { type: type, message: message };
}

// ------------------------------------------------------------
// 状态持久化（$sandbox/state.json）
// ------------------------------------------------------------

function loadState() {
    try {
        if ($file.exists(STATE_PATH)) {
            var parsed = JSON.parse($file.read(STATE_PATH).toUTF8());
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) { /* 读取失败按无状态处理 */ }
    return {};
}

function saveState(state) {
    try {
        $file.write({ data: $data.fromUTF8(JSON.stringify(state)), path: STATE_PATH });
    } catch (e) { /* 忽略写失败 */ }
}

// ------------------------------------------------------------
// 请求封装（自动携带 X-Auth-Uuid / X-Auth-Token）
// ------------------------------------------------------------

function makeRequester(uuid, token) {
    return async function request(method, path, payload, query) {
        var headers = {};
        for (var k in AUTH_HEADERS) headers[k] = AUTH_HEADERS[k];
        headers['X-Auth-Uuid'] = uuid;
        headers['X-Auth-Token'] = token;
        if (payload !== undefined && payload !== null) {
            headers['Content-Type'] = 'application/json'; // body 自动 JSON 编码
        }
        var options = { method: method, url: BAIMIAO_API + path + (query || ''), header: headers };
        if (payload !== undefined && payload !== null) options.body = payload;
        return $http.request(options);
    };
}

// ------------------------------------------------------------
// 插件入口
// ------------------------------------------------------------

function supportLanguages() {
    return SUPPORTED_LANGUAGES.slice();
}

async function ocr(query, completion) {
    function done(obj) {
        if (query && query.onCompletion) query.onCompletion(obj);
        else if (completion) completion(obj);
    }

    try {
        if (!query || !query.image) throw errorObj('param', '未收到图片数据');

        var username = ($option.username || '').trim();
        var password = ($option.password || '').trim();
        var state = loadState();
        var uuid = state.uuid || newUuid();
        var token = state.token || '';
        var request = makeRequester(uuid, token);

        // 1. 登录（token 为空/失效时调用）
        async function login() {
            var t = '';
            if (username && password) {
                var loginRes = await request('POST', '/user/login', {
                    username: username,
                    password: password,
                    type: /^[0-9]*$/.test(username) ? 'mobile' : 'email'
                });
                var loginData = loginRes.data || {};
                if (loginRes.response.statusCode !== 200 || loginData.code !== 1 || !loginData.data || !loginData.data.token) {
                    throw errorObj('secretKey', '白描登录失败：' + (loginData.msg || String(JSON.stringify(loginData)).slice(0, 200)));
                }
                t = loginData.data.token;
            } else {
                var anonRes = await request('POST', '/user/login/anonymous', {});
                var anonData = anonRes.data || {};
                if (anonRes.response.statusCode !== 200 || anonData.code !== 1 || !anonData.data) {
                    throw errorObj('network', '白描匿名登录失败：' + (anonData.msg || String(JSON.stringify(anonData)).slice(0, 200)));
                }
                t = anonData.data.token || '';
                if (!t) {
                    throw errorObj('secretKey', '当前匿名额度已用完，请在插件设置中填写白描账号（手机号/邮箱 + 密码）');
                }
            }
            state.uuid = uuid;
            state.token = t;
            saveState(state);
            return t;
        }

        // 2. 申请识别额度（v2）；未登录/失效时自动重登一次
        async function getPerm() {
            var permRes = await request('POST', '/perm/single', { mode: 'single', version: 'v2' });
            return permRes.data || {};
        }
        var perm = await getPerm().catch(function (e) { return { __err: String(e) }; });
        if (perm.__err || perm.code !== 1 || !perm.data || !perm.data.token || !perm.data.engine) {
            token = await login();
            request = makeRequester(uuid, token);
            perm = await getPerm();
        }
        if (perm.__err) throw errorObj('network', perm.__err);
        if (perm.code !== 1 || !perm.data || !perm.data.token || !perm.data.engine) {
            throw errorObj('api', '白描额度获取失败（可能已达今日上限）：' + (perm.msg || JSON.stringify(perm).slice(0, 200)));
        }
        var permToken = perm.data.token;
        var engine = perm.data.engine;

        // 3. 获取 OSS 上传签名
        var signRes = await request('GET', '/oss/sign?mime_type=' + UPLOAD_MIME);
        var signData = signRes.data || {};
        if (signRes.response.statusCode !== 200 || signData.code !== 1 || !signData.data || !signData.data.result) {
            throw errorObj('api', '获取白描上传签名失败：' + (signData.msg || String(JSON.stringify(signData)).slice(0, 200)));
        }
        var oss = signData.data.result;

        // 上传图片：手工构造 multipart 字节流（file 字段必须在最后，
        // Bob 的 files 封装无法保证字段顺序，会触发 OSS 400 "check the order of the fields"）
        var base64 = query.image.toBase64();
        var dataUrl = 'data:' + UPLOAD_MIME + ';base64,' + base64;
        var imgHash = sha1Hex(dataUrl);
        var boundary = '----SaladictBoundary' + newUuid().replace(/-/g, '');
        var formFields = [
            ['success_action_status', '200'],
            ['policy', oss.policy],
            ['x-oss-signature', oss.signature],
            ['x-oss-signature-version', 'OSS4-HMAC-SHA256'],
            ['x-oss-credential', oss.x_oss_credential],
            ['x-oss-date', oss.x_oss_date],
            ['key', oss.file_key],
            ['x-oss-security-token', oss.security_token]
        ];
        var head = '';
        for (var fi = 0; fi < formFields.length; fi++) {
            head += '--' + boundary + CRLF +
                'Content-Disposition: form-data; name="' + formFields[fi][0] + '"' + CRLF + CRLF +
                formFields[fi][1] + CRLF;
        }
        head += '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="file"; filename="blob"' + CRLF +
            'Content-Type: ' + UPLOAD_MIME + CRLF + CRLF;

        var bodyData = $data.fromUTF8(head);
        bodyData.appendData($data.fromBase64(base64));
        bodyData.appendData($data.fromUTF8(CRLF + '--' + boundary + '--' + CRLF));

        var uploadRes = await $http.request({
            method: 'POST',
            url: oss.host,
            header: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
            body: bodyData // $data 类型 body 不编码，直接发送
        });
        var upStatus = uploadRes && uploadRes.response && uploadRes.response.statusCode;
        if (upStatus !== 200) {
            throw errorObj('network', '图片上传失败（OSS Http ' + (upStatus || '未知') + '）：' +
                String(uploadRes && uploadRes.data || '').slice(0, 300));
        }

        // 4. 提交识别（v2：携带 fileKey，不再携带 dataUrl）
        var submitRes = await request('POST', '/ocr/image/' + engine, {
            batchId: '',
            total: 1,
            token: permToken,
            hash: imgHash,
            fileKey: oss.file_key
        });
        var submitData = submitRes.data || {};
        if (submitRes.response.statusCode !== 200 || submitData.code !== 1 || !submitData.data || !submitData.data.jobStatusId) {
            throw errorObj('api', '白描识别提交失败：' + (submitData.msg || String(JSON.stringify(submitData)).slice(0, 200)));
        }
        var jobStatusId = submitData.data.jobStatusId;

        // 5. 轮询识别结果
        var statusPath = '/ocr/image/' + engine + '/status?jobStatusId=' + encodeURIComponent(jobStatusId);
        for (var i = 0; i < POLL_MAX; i++) {
            await sleep(POLL_INTERVAL_SEC);
            var statusRes = await request('GET', statusPath);
            var sData = statusRes.data || {};
            if (statusRes.response.statusCode !== 200 || sData.code !== 1 || !sData.data) {
                throw errorObj('api', '白描识别状态查询失败：' + (sData.msg || String(JSON.stringify(sData)).slice(0, 200)));
            }
            if (!sData.data.isEnded) continue;
            var yd = sData.data.ydResp;
            var rows = yd && (yd.words_result || (yd.Result && yd.Result.words_result));
            if (!rows) {
                throw errorObj('api', '白描识别失败：' + String(JSON.stringify(yd || sData.data)).slice(0, 300));
            }
            var text = '';
            for (var r = 0; r < rows.length; r++) {
                text += rows[r].words;
                if (r < rows.length - 1) text += '\n';
            }
            var texts = text.split('\n').map(function (line) {
                return { text: line };
            });
            done({
                result: {
                    from: query.detectFrom,
                    texts: texts
                }
            });
            return;
        }
        throw errorObj('api', '白描识别超时，请稍后重试');
    } catch (e) {
        var err = (e && e.type && e.message) ? e : errorObj('unknown', String(e && e.message ? e.message : e));
        done({ error: err });
    }
}

// Bob 以 CommonJS 方式加载插件，入口函数必须挂到 exports 上才能被识别
if (typeof exports !== 'undefined' && exports) {
    exports.ocr = ocr;
    exports.supportLanguages = supportLanguages;
}
