#!/bin/sh
# Opens the page where you paste optional keys. Double-click this file.
# It runs the prebuilt tools in this folder; nothing is installed or changed.
cd "$(dirname "$0")" || exit 1

wait_for_key() {
  if [ -z "$AI4S_NO_PAUSE" ] && [ -t 0 ]; then
    printf '%s' "Press Return to close / 按回车键关闭 "
    read -r _unused
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is needed. Install the current LTS from https://nodejs.org/ and double-click this file again."
  echo "需要先安装 Node.js 22.13 或更新版本。请到 https://nodejs.org/ 安装当前的 LTS 版本，然后再双击这个文件。"
  wait_for_key
  exit 1
fi

node runtime/bundle/index.mjs --setup "$@"
code=$?
if [ "$code" -ne 0 ]; then wait_for_key; fi
exit "$code"
