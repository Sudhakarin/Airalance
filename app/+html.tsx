// app/+html.tsx
// Web-only HTML shell — global CSS to kill ALL focus outlines

import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />

        <style
          dangerouslySetInnerHTML={{
            __html: `
              *:focus {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                outline-color: transparent !important;
                box-shadow: none !important;
              }
              input, textarea, select, button {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                box-shadow: none !important;
                border: none !important;
                -webkit-appearance: none;
                -webkit-tap-highlight-color: transparent;
              }
              input:focus, textarea:focus, select:focus, button:focus {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                box-shadow: none !important;
                border: none !important;
              }
              input::-moz-focus-inner,
              button::-moz-focus-inner {
                border: 0 !important;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
