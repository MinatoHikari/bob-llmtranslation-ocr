#!/usr/bin/env python3
"""打包脚本：将白描插件打包为 .bobplugin

.bobplugin 本质是一个 zip 压缩包，info.json / main.js / icon.png 必须位于压缩包根目录，
文件名为插件 identifier（info.json 里的 identifier 字段）+ .bobplugin 后缀。
运行: python baimiao/build.py  （产物统一输出到仓库根 dist/，双击即可安装到 Bob）
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(os.path.dirname(HERE), 'dist')

PLUGIN_ID = 'com.saladict.bob.baimiao-ocr'  # 与 info.json 的 identifier 保持一致
FILES = ['info.json', 'main.js', 'icon.png']

os.makedirs(DIST, exist_ok=True)
out = os.path.join(DIST, PLUGIN_ID + '.bobplugin')

if os.path.exists(out):
    os.remove(out)

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        z.write(os.path.join(HERE, name), name)  # 第二个参数 = 压缩包内路径，必须是根目录

print('打包完成:', out)
