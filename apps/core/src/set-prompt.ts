import { DEFAULT_SYSTEM_PROMPT, loadConfig, openDatabase, updateSystemPrompt } from "@maximus/agent-runtime";

const db = openDatabase(loadConfig());
updateSystemPrompt(db, DEFAULT_SYSTEM_PROMPT);
console.log("System prompt updated.");
console.log(DEFAULT_SYSTEM_PROMPT);
