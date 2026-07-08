# Agent 维护规则

- 不要直接编辑 `dist/`、`publish/`、`release` 分支产物或其他生成文件；需要更新产物时应修改源码或规则输入后重新生成。
- 优先编辑源码（例如 `src/`、`scripts/`）以及人工维护规则文件（例如 `rules/**/manual.txt`、`rules/**/exclude.txt`）。
- 不要提交机场订阅 URL、访问 token、密钥或任何私密订阅信息；示例也应使用占位符。
- 修改后运行 `./scripts/validate.sh`，确认源码与发布产物的基础校验通过。
