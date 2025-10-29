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
/**
 * Public key store for the custom IDP emulation. The helix-html-pipeline reads this via.
 * https://admin.hlx.page/auth/discovery/keys
 *
 * Whenever the private key is rotated, it's public counterpart should be added here.
 * @todo add expiration and certificates
 */

export default {
  keys: [
    {
      kty: 'RSA',
      n: 'zx5gi18-9uasyrY-xHM5iJDC7juPpqzV6Jidqt8zuET2d6fDoSM89gx1fHf2QQwtQfM8fg-vKnYR7YlhO6HJhEBC47hlnv1zLg74O4KldCd2tuI3fHjyMGldXcdeSNxhVMmBcfEAtrRaX6-2pM0WAkJ2aGdXGB9q51MG7r4Rwe3s3ZSAbFNiqLY20soz1eS46EhvpccUK5RomEiOAb0_qr4k2D0ck-oENVq0LIIGYv-6Yf0acEE4NeW8eCPFbJB4BVvaQFkYl_DHQLeJ8uDZDQksmClLqYJ7-mtAZVZ8T7cIq_7LuznPl8orPCjaunMBprSYQeb31A_IBNn8Eda1DQ',
      e: 'AQAB',
      kid: '7soi87zdosIFw8o__mTykO6BUQ4FAThchyr4fjcWRmg',
      issuer: 'https://admin.hlx.page/',
    },
  ],
};
