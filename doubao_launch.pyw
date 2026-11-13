# -*- coding: utf-8 -*-
"""豆包签名服务无窗口启动器（pythonw.exe 托管 node.exe）。

pythonw 下 sys.stdout 为 None，所以全程只写文件日志、绝不 print。
node 以 CREATE_NO_WINDOW 启动，崩溃后 5 秒自动拉起（替代 doubao_signer.bat
的自愈循环，且不依赖 wscript/cmd 这类受限宿主）。
"""
import os
import shutil
import subprocess
import time

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)
LOG = os.path.join(BASE, "doubao_sign.log")
CREATE_NO_WINDOW = 0x08000000


def find_node():
    p = shutil.which("node") or shutil.which("node.exe")
    if p:
        return p
    cand = os.path.join(
        os.environ.get("USERPROFILE", ""), ".workbuddy", "binaries",
        "node", "versions", "22.22.2-3", "node.exe",
    )
    return cand if os.path.isfile(cand) else ""


def note(msg):
    try:
        with open(LOG, "a", encoding="utf-8", errors="replace") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass


node = find_node()
if not node:
    note("[launcher] 找不到 node.exe，签名服务无法启动")
    raise SystemExit(1)
note("[launcher] 启动豆包签名服务 node=%s" % node)

_log = open(LOG, "a", encoding="utf-8", errors="replace")
while True:
    try:
        p = subprocess.Popen(
            [node, "doubao_sign.js"],
            cwd=BASE,
            stdout=_log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
        rc = p.wait()
        note("[launcher] node 退出 rc=%s，5 秒后重启" % rc)
    except Exception as e:
        note("[launcher] 启动异常: %s，5 秒后重试" % e)
    _log.flush()
    time.sleep(5)
