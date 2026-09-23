// app/+html.tsx
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
              * {
                outline: none !important;
                -webkit-tap-highlight-color: transparent;
              }
              *:focus, *:focus-visible, *:active {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                outline-color: transparent !important;
                box-shadow: none !important;
              }
              input, textarea, select {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                outline-color: transparent !important;
                box-shadow: none !important;
                border: none !important;
                border-width: 0 !important;
                background: transparent !important;
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                appearance: none !important;
              }
              input:focus, textarea:focus, select:focus,
              input:focus-visible, textarea:focus-visible,
              input:active, textarea:active {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                box-shadow: none !important;
                border: none !important;
                border-width: 0 !important;
                background: transparent !important;
              }
              input::-moz-focus-inner,
              button::-moz-focus-inner {
                border: 0 !important;
                padding: 0 !important;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
