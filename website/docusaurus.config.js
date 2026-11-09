// @ts-check
const { themes } = require("prism-react-renderer");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "sideagent",
  tagline: "Your help centre, answering inside your app",
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
          routeBasePath: "docs",
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/egig/sideagent/edit/main/website/",
          editLocalizedFiles: true,
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      }),
    ],
  ],
  plugins: [
    [
      "@docusaurus/plugin-client-redirects",
      {
        // The docs moved from the site root to /docs when the landing page took the root.
        // Old links such as /sideagent/quickstart keep working through these redirects.
        createRedirects(existingPath) {
          if (existingPath.startsWith("/docs/") && existingPath !== "/docs/") {
            return [existingPath.replace(/^\/docs/, "")];
          }
          return undefined;
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "sideagent",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        { to: "/roadmap", position: "left", label: "Roadmap" },
        { type: "localeDropdown", position: "right" },
        { href: "https://github.com/egig/sideagent", label: "GitHub", position: "right" },
      ],
    },
    prism: { theme: themes.github, darkTheme: themes.dracula },
  },
};

module.exports = config;
