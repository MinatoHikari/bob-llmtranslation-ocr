#!/usr/bin/env python3
"""打包脚本示例：将两个 Bob 插件打包为 .bobplugin

.bobplugin 本质是一个 zip 压缩包，info.json / main.js / icon.png 必须位于压缩包根目录，
文件名为插件 identifier（info.json 里的 identifier 字段）+ .bobplugin 后缀。
运行: python build.py  （产物在 dist/ 目录，双击 .bobplugin 即可安装到 Bob）
"""
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
