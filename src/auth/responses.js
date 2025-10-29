/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Response } from '@adobe/fetch';

/**
 * Creates the html that is used to send a message to the sidekick extension.
 * @param {string} extensionId The ID of the sidekick extension
 * @param {object} msg Message to send
 * @returns {string} the html response
 */
export function createSendMessageHtml(extensionId, msg) {
  const encodedExtensionId = JSON.stringify(extensionId).replace(/</g, '\\u003c');
  const encodedMsg = JSON.stringify(msg).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
    <head>
        <title>Login successful</title>
    </head>
    <script>
        function handler(resp) {
          console.log('got response from sidekick:', resp);
          window.close();
        }

        if (window.browser) {
          browser.runtime.sendMessage(${encodedExtensionId}, ${encodedMsg})
            .then(handler)
            .catch((err) => {
              console.error('error invoking extension:', err);
            });
        } else {
          chrome.runtime.sendMessage(${encodedExtensionId}, ${encodedMsg}, (resp) => {
            if (resp) {
              handler(resp);
            } else {
              console.error('error invoking extension:', chrome.runtime.lastError);
            }
          });
        }
    </script>
</html>
`;
}

export function sendAEMCLILoginInfoResponse(redirectUrl, body) {
  if (!redirectUrl.startsWith('http')) {
    // avoid javascript:alert("xss") when redirecting
    return new Response('', { status: 401 });
  }
  const encodedRedirectUrl = JSON.stringify(redirectUrl).replace(/</g, '\\u003c');
  const encodedBody = JSON.stringify(body).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>AEM CLI Login</title>
    <script type="module">
      async function sendPost(url, body) {
        const response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });

        if (response.ok) {
          console.log('Post request successful:', await response.text());
        } else {
          console.error('Post request failed:', response.status);
        }

        window.location.replace(url);
      }

      document.querySelector('#confirm-button').addEventListener('click', () => {
        sendPost(${encodedRedirectUrl}, ${encodedBody});
      });
    </script>
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 40px;
      }
      #confirm-button {
        background-color: #0265dc;
        border-color: #0000;
        color: #fff;
        border-radius: 16px;
        padding: 4px 14px;
      }
    </style>
  </head>
  <body>
    <p>You are about to send your personal site token to the <strong>aem-cli</strong> running at <strong>${encodedRedirectUrl}</strong></p>
    <p>If this looks correct please click the <strong>Send</strong> button below, otherwise close the window.</p>
    <button id="confirm-button">Send</button>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      // don't send cookie.
    },
  });
}

/**
 * Creates the html that closes the window.
 *
 * @param {object} title document title to send
 * @returns {string} the html response
 */
export function createCloseHtml(title = 'Login successful') {
  return `<!DOCTYPE html>
<html>
    <head>
        <title>${title}</title>
    </head>
    <script>
      window.close();
    </script>
</html>
`;
}

/**
 * Creates the html that redirects the client to the given url.
 *
 * @param {string} url the url to redirect to
 * @returns {string} the html response
 */
export function createClientSideRedirectHtml(url) {
  return `<!DOCTYPE html>
<html>
    <head>
        <title>Redirecting...</title>
        <meta http-equiv = "refresh" content = "0; url = ${url}" />
    </head>
</html>
`;
}
