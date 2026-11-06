// Shared by the e2e server and the tests.
export const LLM_BASE_URL = "https://llm.example.com/v1";
/** A key the fake provider refuses, to show the connection check failing. */
export const WRONG_KEY = "sk-wrong-key-0000";
export const GOOD_KEY = "sk-e2e-good-key-1234";
export const DOCS_PAGE = "https://docs.example.com/refunds";
export const APP_ORIGIN = "https://app.example.com";
/** The monthly cap the builtin-model server reports. */
export const BUILTIN_LIMIT = 100;
