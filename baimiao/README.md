# 白描 OCR v2（Bob 插件）

适用于 **Bob**（macOS 划词翻译软件）的白描 OCR 文字识别插件。

Bob 插件社区中没有白描插件，本插件按白描网页版 **v2 接口**逆向实现（OSS 上传 + fileKey 提交），并针对 Bob 的运行时做了适配（`$http` / `$file` 持久化 / `$timer` 轮询）。同名 Saladict/Pot 版插件见 [MinatoHikari/pot-saladict-baimiao-ocrv2](https://github.com/MinatoHikari/pot-saladict-baimiao-ocrv2)。

## 安装

1. 从 [Releases](../../releases) 下载 `com.saladict.bob.baimiao-ocr.bobplugin`
2. 双击文件即可安装到 Bob（或在 Bob 偏好设置 → 插件 中手动安装）
3. 在插件设置里填写白描账号（手机号/邮箱 + 密码），保存即可

## 配置

| 配置项 | 说明 |
|---|---|
| 手机号/邮箱 | 选填。不填走匿名模式（匿名额度很少且按 IP 共享，**推荐填写**） |
| 密码 | 选填，与上面配套 |

## 特性

- 白描网页版 v2 接口完整实现：登录 → 申请额度 → OSS 签名上传 → `fileKey` 提交 → 轮询结果
- 设备标识（`X-Auth-Uuid`，标准 UUID v4）与登录 token 通过 `$file` 持久化在插件沙盒：
  - 不会被识别为"新设备登录"
  - token 复用，减少重复登录；失效时自动重登
- 纯 JS 实现 SHA1，无第三方依赖；适配 Bob 的 JavaScriptCore 运行时（无 `crypto`/`setTimeout` 依赖）
- 识别结果按行返回，支持 Bob 的智能分段展示

## 工作原理

```
登录（账号/匿名）
  └─ POST /api/perm/single {mode:'single', version:'v2'}     申请额度，得到 engine + token
       └─ GET /api/oss/sign?mime_type=image/png               获取阿里云 OSS 签名
            └─ POST {host}（multipart：签名字段 + 图片，file 字段必须在最后）
                 └─ POST /api/ocr/image/{engine} {batchId,total,token,hash,fileKey}
                      └─ GET /api/ocr/image/{engine}/status?jobStatusId=...   直到 isEnded
```

> 注意：v2 接口不再接受图片 dataUrl 直接提交（旧插件失效的原因），必须先上传到 OSS。

## 打包脚本示例

`.bobplugin` 本质是一个 zip：**info.json、main.js、图标文件必须位于压缩包根目录**，文件名为插件 identifier + `.bobplugin` 后缀。用 Python 打包（`python build.py`，产物在 `dist/`）：

```python
#!/usr/bin/env python3
"""打包脚本示例：将插件打包为 .bobplugin"""
import os
import zipfile

PLUGIN_ID = 'com.saladict.bob.baimiao-ocr'  # 与 info.json 的 identifier 保持一致
FILES = ['info.json', 'main.js', 'icon.png']

os.makedirs('dist', exist_ok=True)
out = os.path.join('dist', PLUGIN_ID + '.bobplugin')

if os.path.exists(out):
    os.remove(out)

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        z.write(name, name)  # 第二个参数 = 压缩包内路径，必须是根目录

print('打包完成:', out)
```

等价的命令行方式：

```bash
zip com.saladict.bob.baimiao-ocr.bobplugin info.json main.js icon.png
```

> 注意：zip 内必须存在 `info.json`（含 `category` 字段）和 `main.js`，且**入口函数必须挂到 `exports` 上**（Bob 以 CommonJS 方式加载插件，仅顶层 `function` 声明会报"插件未实现 xx 方法"）。

推送代码后 GitHub Actions（`.github/workflows/build.yml`）会自动打包并上传 artifact，打 `v*` 标签时会自动发布到 Release。

## 目录结构

```
main.js                      插件逻辑（普通脚本，定义 ocr(query, completion) 与 supportLanguages()）
info.json                    元数据与配置声明（needs→options：username / password）
icon.png                     图标
build.py                     打包脚本
.github/workflows/build.yml  CI：自动打包，tag 时自动发布 Release
```

## 致谢与许可

- 接口流程与 Saladict/Pot 版插件一致：[MinatoHikari/pot-saladict-baimiao-ocrv2](https://github.com/MinatoHikari/pot-saladict-baimiao-ocrv2)
- 流程参考原版 [pot-app-recognize-plugin-baimiao](https://github.com/TechDecryptor/pot-app-recognize-plugin-baimiao)，按白描 v2 接口重写

[MIT](LICENSE) © 2026 MinatoHikari
