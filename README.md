# Revu

React + TypeScript + Monaco 构建的轻量源码编辑器。

## 运行

需要 Node.js 22.12+，使用桌面 Chrome 或 Edge：

~~~sh
npm install
npm run dev
~~~

打开终端显示的 localhost 地址。生产检查和构建：npm run build，预览：npm run preview。

## 使用

- 点击「打开文件夹」，授权本地目录访问；文件夹按展开时读取。
- 点击文件打开标签；支持语法高亮、搜索、撤销和多文件切换。
- 点击保存或按 Ctrl+S，将当前内容写回原文件。
- 左侧文件按钮切换文件管理器，底部按钮切换黑白主题。
- 关闭未保存文件、切换目录或离开页面时提示。刷新后需重新打开目录，只有主题偏好会被保存。

本项目使用 File System Access API，只支持桌面 Chrome / Edge 的 localhost 或 HTTPS 环境。Monaco 与 Worker 均本地打包，无 CDN 依赖。

这是 UTF-8 文本/代码编辑 MVP，不适用于二进制文件或其他文本编码。暂不提供 Markdown 预览、文件增删改名、外部文件变更同步、Git、Agent 或后端。