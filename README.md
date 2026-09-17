# Bob 插件：DeepSeek / GLM 翻译 + 识别

适用于 **Bob**（macOS 划词翻译软件）的两个 LLM 插件，使用你自己的 API Key 调用 **DeepSeek** 与 **智谱 GLM（Z.ai / open.bigmodel.cn）** 的 OpenAI 兼容接口：

| 目录 | 插件 | 说明 |
|---|---|---|
| `translate/` | DeepSeek / GLM 翻译 | 文本翻译，支持任意模型 |
| `ocr/` | DeepSeek / GLM 识别 | 截图/图片文字识别（OCR），走视觉模型 |

## 特性

- **DeepSeek 官方**：翻译用 `deepseek-chat`，识别用视觉模型 `deepseek-flash`（图片以 base64 data URL 传入，且仅出现在 user 消息中，符合官方要求）
- **Z.ai 国际站**：按量付费 `https://api.z.ai/api/paas/v4` 与 **GLM Coding Plan** `https://api.z.ai/api/coding/paas/v4` 均已内置
- **智谱中国站**：按量付费 `https://open.bigmodel.cn/api/paas/v4` 与 **Coding Plan** `https://open.bigmodel.cn/api/coding/paas/v4` 均已内置
- **自定义接口**：任意 OpenAI 兼容端点（自动补全 `/chat/completions`），可直连本地部署的 DeepSeek-OCR、llama-server、vLLM 等
- **模型可自由填写**，默认值按所选接口自动匹配（翻译 `deepseek-chat` / `glm-4.7`，识别 `deepseek-flash` / `glm-4.6v`）
- GLM 模型自动关闭深度思考（`thinking: disabled`）提升速度；识别插件可手动改为"开启"或"不发送"
- OCR 结果自动清洗模型自行附加的 `OCR Result` / `Translation` 标签与"顺手翻译"
- Bob 支持同一插件添加多个实例（例如一个 DeepSeek、一个 GLM）并行对比

## 安装

1. 从 [Releases](../../releases) 下载 `.bobplugin` 文件
2. 双击文件即可安装到 Bob
3. 在 Bob 的插件设置里填写 API Key、选择接口（模型可留空用默认），保存即可

## 接口对照表

| 设置项「接口」 | 实际地址 | 适用 Key |
|---|---|---|
| DeepSeek 官方 | `https://api.deepseek.com/chat/completions` | [platform.deepseek.com](https://platform.deepseek.com) 的 API Key |
| Z.ai 国际站 · 按量付费 | `https://api.z.ai/api/paas/v4/chat/completions` | [z.ai](https://z.ai) 开放平台 API Key |
| Z.ai 国际站 · Coding Plan | `https://api.z.ai/api/coding/paas/v4/chat/completions` | GLM Coding Plan（国际版）订阅页生成的 Key |
| 智谱中国站 · 按量付费 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | [open.bigmodel.cn](https://open.bigmodel.cn) 的 API Key |
| 智谱中国站 · Coding Plan | `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions` | GLM Coding Plan（中国版）订阅页生成的 Key |
| 自定义 (OpenAI 兼容) | 填在「自定义接口地址」，如 `http://127.0.0.1:8080/v1` | 本地模型 / 第三方中转，Key 可留空 |

自定义接口地址会自动补全 `/chat/completions`；如果填的已是完整路径则原样使用。

> **注意**：Bob 的插件配置里，下拉菜单默认只是"显示"第一项，建议**点选一次**确认。即使不点选，插件也会按代码内置默认值工作（翻译默认 DeepSeek 官方 + `deepseek-chat`，识别默认 Z.ai 按量付费 + `glm-4.6v`）。

## 识别插件说明

- 默认识别提示词以 GLM 视觉模型的训练格式 `Free OCR.` 开头，并显式**禁止翻译、禁止添加标题标签**；识别结果返回前还会自动剥离模型自行附加的 `OCR Result` / `Translation` 小节
- 「深度思考」选项仅对 GLM 模型生效：关闭（默认，更快）/ 开启（更准）/ 不发送参数
- 连接本地模型：接口选「自定义」，地址填 `http://127.0.0.1:8080/v1`（例如 `vllm serve deepseek-ai/DeepSeek-OCR` 或 llama.cpp 的 `llama-server`），API Key 留空，模型填服务端对应的模型名

## 打包脚本示例

`.bobplugin` 本质是一个 zip：**info.json、main.js、图标文件必须位于压缩包根目录**，文件名为插件 identifier + `.bobplugin` 后缀。用 Python 打包（`python build.py`，产物在 `dist/`）：

```python
#!/usr/bin/env python3
"""打包脚本示例：将两个 Bob 插件打包为 .bobplugin"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

PLUGINS = [
    ('translate', 'com.saladict.bob.llm-translate'),  # 与 info.json 的 identifier 保持一致
    ('ocr', 'com.saladict.bob.llm-ocr'),
]

FILES = ['info.json', 'main.js', 'icon.png']

os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
for dir_name, identifier in PLUGINS:
    src = os.path.join(HERE, dir_name)
    out = os.path.join(HERE, 'dist', identifier + '.bobplugin')
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            z.write(os.path.join(src, name), name)  # 第二个参数 = 压缩包内路径，必须是根目录
    print('打包完成:', out)
```

等价的命令行方式（以翻译插件为例）：

```bash
zip com.saladict.bob.llm-translate.bobplugin translate/info.json translate/main.js translate/icon.png
```

> 注意：三个文件必须在压缩包根目录（不能套文件夹）；并且 Bob 以 CommonJS 方式加载 `main.js`，**入口函数必须挂到 `exports` 上**（`exports.translate = translate;` / `exports.ocr = ocr;`），否则会报"插件未实现 xx 方法"。

推送代码后 GitHub Actions（`.github/workflows/build.yml`）会自动打包并上传 artifact，打 `v*` 标签时会自动发布到 Release。

## 目录结构

```
translate/                     翻译插件源码（info.json + main.js + icon.png）
ocr/                           识别插件源码
test.mjs                       冒烟测试（bun test.mjs 或 node test.mjs）
build.py                       打包脚本
.github/workflows/build.yml    CI：自动打包，tag 时自动发布 Release
```

## 插件运行契约速查

- `main.js` 为普通脚本，Bob 用 JavaScriptCore 以 CommonJS 方式加载，入口函数需挂 `exports`
- 翻译插件：`supportLanguages()` + `translate(query, completion)`（query 提供 `text/detectFrom/detectTo`，Bob 语言代码如 `zh-Hans`/`en`）
- 识别插件：`supportLanguages()` + `ocr(query, completion)`（`query.image` 为 `$data`，用 `.toBase64()` 转 base64）
- 请求用 `$http.request`（`header` 含 `Content-Type: application/json` 时 body 自动 JSON 编码），响应读 `resp.response.statusCode` 与 `resp.data`
- 配置用 `$option.<identifier>` 读取

## 致谢与许可

[MIT](LICENSE) © 2026 MinatoHikari
