import React from "react";
import Head from "@docusaurus/Head";

// The landing and roadmap pages use the sideagent brand faces; the docs keep the theme's system font.
export default function Fonts() {
  return (
    <Head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500&family=Source+Sans+3:wght@400;600;700&display=swap"
      />
    </Head>
  );
}
