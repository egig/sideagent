// @ts-check
const { themes } = require("prism-react-renderer");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "sideagent",
  tagline: "Embed a chat agent in your app from an OpenAPI spec",
  url: "https://egig.github.io",
  baseUrl: "/sideagent/",
  organizationName: "egig",
  projectName: "sideagent",
  onBrokenLinks: "throw",
  onBrokenAnchors: "warn",
  markdown: { hooks: { onBrokenMarkdownLinks: "throw" } },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "id"],
    localeConfigs: {
      en: { label: "English", htmlLang: "en" },
      id: { label: "Bahasa Indonesia", htmlLang: "id" },
    },
  },
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/egig/sideagent/edit/main/website/",
          editLocalizedFiles: true,
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      }),
    ],
  ],
  themeConfig: {
    navbar: {
      title: "sideagent",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        { type: "localeDropdown", position: "right" },
        { href: "https://github.com/egig/sideagent", label: "GitHub", position: "right" },
      ],
    },
    prism: { theme: themes.github, darkTheme: themes.dracula },
  },
};

module.exports = config;
