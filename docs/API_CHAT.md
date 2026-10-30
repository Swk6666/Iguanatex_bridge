# OpenAI API 对话

WPS、PowerPoint 加载项和浏览器 PPTX 编辑器的 AI 助手使用 OpenAI Chat Completions API，支持文字、图片和连续追问。默认模型为 `gpt-6-astra`，可在 API 设置中更改为账户有权使用且支持图片输入的模型。

1. 在 WPS 演示中打开 IguanaTex 编辑器，选择 **AI 助手 → API 设置**。
2. 填写 OpenAI API Key 并保存。密钥输入框会清空；留空保存会保留已有密钥。
3. 输入文字或添加图片后点击发送。文字、图片和项目指令会发送至 OpenAI，并按 API 用量计费。

密钥可以保存在用户状态目录的 `openai-api.json`（Linux 文件权限为 600），也可以通过 `OPENAI_API_KEY` 环境变量或仓库根目录的 `shared-openai-key` 提供。读取优先级为本机设置、环境变量、仓库密钥。仓库文件随 Git 共享，所有能读取仓库和历史的人都能使用其密钥。原来的 `deepseek-api.json` 不会被读取或删除，避免把 DeepSeek 密钥发送给 OpenAI。删除本机密钥不会清除环境变量。

AI 指令保存在项目的 `AI_INSTRUCTIONS.md`，HTML 注释不会发送；请勿在该文件中存放密钥。对话仅在服务内存中保留，重启服务后清空。API 账单及模型可用性取决于 OpenAI 账户，ChatGPT 订阅与 API 账单独立。

如出现 401，请检查 API Key；429 请检查 API 限速和账户额度；模型不可用时请在设置中更换。生成的 LaTeX 应在插入前预览检查。

接口和模型文档：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat) · [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)。
