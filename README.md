# Paint Together

独立的 WigglyPaint 画室与 AI 共绘示例。原版画板使用 John Earnest（Internet Janitor）创作的 WigglyPaint。这个项目增加了画室界面、作品存储和共绘工具。项目由社区独立维护。

An independent WigglyPaint studio and shared canvas with an optional AI drawing partner.

## 功能

- **画室**支持手绘、笔刷和配色、撤销重做、本机草稿、作品集、横屏放大和抖动 GIF 导出。
- **一起画**支持邀请画伴、共享画布、按笔迹分段同步、撤销自己的笔迹和保存共同作品。
- **AI 工具**支持接受或拒绝邀请、查看画布、画笔迹、改配色和分享作品。模型给出坐标与笔刷参数，再由原版画笔绘制。默认离线模式使用预设笔迹，便于体验和测试。

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci
npm start
```

打开 [本地画室](http://127.0.0.1:3000)。在「画室」可以直接绘画。切到「一起画」，发出邀请，再发送一句话，就能在画板上看到预设笔迹。打开两个同源标签页，可以验证共同画布同步。

```sh
npm test
```

## 接入自己的模型

复制 `.env.example` 为 `.env`，按模型服务的要求填写 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`，再重启。Base URL 填到 API 根路径，例如服务文档中的 `/v1`，代码会附加 `/chat/completions`。部分本地模型服务可将密钥留空。

模型服务需要兼容 Chat Completions 的函数调用和工具结果消息。若希望 AI 通过 `look_painting` 查看画面，模型还需接受 `image_url` 格式的图片输入。密钥由 Node.js 服务读取。

## 集成到自己的前端

- `public/paint.html` 和对应的画室脚本展示单人和共绘界面。可参照 `public/shell.js`，在同源宿主提供 JSON 请求、SSE 订阅和作品分享回调。
- `public/paint-frame-v1.js` 负责画板状态桥，`public/paint-joint-client-v1.js` 负责同步及未确认笔迹重试。画板通过同源消息通信。
- `paint-service.js` 和 `paint-joint-service.js` 提供作品 API、邀请和共同画布。接入自己的应用时，把当前用户、房间和会话权限接到路由鉴权，并从服务端传入可信的房间 ID。
- `PAINT_TOOLS` 是工具定义。可参照 `ai-partner.js` 执行经过校验的调用。用户笔迹和 AI 笔迹由服务端分别标记，共同画布用 SSE 推送变更。

## 数据与运行边界

默认服务绑定回环地址，属于单机单工作区示例。画作、分享快照和对话存在本机的 `.data/`，草稿存在浏览器本地存储。启用模型后，本轮和近期对话会发往你配置的服务，AI 调用查看工具时还会发送画布预览。若用于多用户或联网部署，请先实现身份验证、房间权限、存储隔离和用量限制。

## 署名与许可

- **WigglyPaint** 由 John Earnest（Internet Janitor）创作。上游声明代码使用 MIT，素材使用 CC0。[上游项目与许可说明](https://internet-janitor.itch.io/wigglypaint)
- 原版 HTML 保留在 `public/vendor/wigglypaint/`，嵌入时由本项目附加状态桥。使用了上游 [Decker](https://github.com/JohnEarnest/Decker) 的 Lil 解释器、原版笔刷和 GIF 编码器。
- 画室界面、共绘同步和 AI 工具是本仓库的独立扩展。项目与上游无隶属或背书关系。扩展按 [MIT](LICENSE) 发布。详见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。
