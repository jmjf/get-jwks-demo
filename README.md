# get-jwks-demo

This repo demonstrates an issue with typing in `get-jwks@9.0.1` and earlier. The issue affects ESM + TypeScript environments only, not CJS, ESM without TypeScript or CJS + TypeScript environments. In preparation for fixing the issue, I wanted a set of tests to show the issue and confirm the proposed fix. Which was a good thing because the fix was more complex than I originally thought.

The test uses three files that are functionally identical for CJS (require syntax), MJS (import syntax), and TypeScript (import syntax). All three files build a `getJwks` instance and log the cache. TypeScript complains if `getJwks` isn't used, so I added `console.log(getJwks.cache)` to avoid that problem.

For simplicity, I've opted to use `--loader` instead of importing a loader file.

## How to use

- Clone the repo
- `npm i`

**NOTE**: Build scripts remove the target directory because `tsc` complains if it exists with a type file.

### Test CJS mode

- Ensure `package.json` does not have `"type": "module"`.
- Copy `tsconfig-cjs.json` to `tsconfig.json`.
- `npm run` the following scripts, all of which will run and log the cache object.
  - `cjs:require` -- runs `testRequire.cjs`
  - `cjs:mjs` -- runs `testMJS.mjs`
  - `cjs:ts` -- runs `testTS.ts` with ts-node -- trying to run with `--loader` fails for unknown `.ts` extension
  - `build:cjs` -- runs `tsc` to build `testTS.ts` to `lib-cjs`

All scripts above should run without issues.

### Test ESM mode

- In `package.json`, add `"type": "module"`.
- Copy `tsconfig-esm.json` to `tsconfig.json`.
- `npm run` the following scripts.
  - `esm:mjs` -- runs `testMJS.mjs` (uses `ts-node/esm` loader)
  - `esm:ts` -- runs `testTS.mjs` with ts-node (FAILS)
  - `build:esm` -- runs `tsc` to build `testTS.ts` to `lib-esm` (FAILS)

With `get-jwks@9.0.1`, `esm:ts` will fail. `build:esm` reveals the problem:

```text
testTS.ts:3:17 - error TS2349: This expression is not callable.
  Type 'typeof import("/workspace/node_modules/get-jwks/src/get-jwks")' has no call signatures.

3 const getJwks = buildGetJwks();
                  ~~~~~~~~~~~~
```

### Hacking the fix

Like `get-jwks`, `@fastify/jwt` exports a function as default but doesn't get a TS2349 error. So, let's borrow an idea from them.

In `node_modules/get-jwks/src/get-jwks.d.ts`, replace `export default function buildGetJwks(options?: GetJwksOptions): GetJwks` with

```typescript
declare function buildGetJwks(options?: GetJwksOptions): GetJwks
export = buildGetJwks
```

Now `npm run esm:ts` works, but `build:esm` fails with the following error.

```
node_modules/get-jwks/src/get-jwks.d.ts:33:1 - error TS2309: An export assignment cannot be used in a module with other exported elements.

33 export = buildGetJwks
   ~~~~~~~~~~~~~~~~~~~~~
```

Based on some digging, we need a namespace in the types with the same name as the exported function. `@fastify/jwt` is declaring a namespace, so let's borrow some more ideas from it. We'll replace `get-jwks.d.ts` with the following code.

```typescript
import type { LRUCache } from 'lru-cache'
import type { Agent } from 'https'

type GetPublicKeyOptions = {
  domain?: string
  alg?: string
  kid?: string
}

type JWKSignature = { domain: string; alg: string; kid: string }
type JWK = { [key: string]: any; domain: string; alg: string; kid: string }

type GetJwks = {
  getPublicKey: (options?: GetPublicKeyOptions) => Promise<string>
  getJwk: (signature: JWKSignature) => Promise<JWK>
  getJwksUri: (normalizedDomain: string) => Promise<string>
  cache: LRUCache<string, JWK>
  staleCache: LRUCache<string, JWK>
}

type GetJwksOptions = {
  max?: number
  ttl?: number
  issuersWhitelist?: string[]
  providerDiscovery?: boolean
  jwksPath?: string
  agent?: Agent
  timeout?: number
}

declare namespace buildGetJwks {
  export type { JWKSignature, JWK, GetPublicKeyOptions, GetJwksOptions, GetJwks }
}

declare function buildGetJwks(options?: GetJwksOptions): GetJwks
export = buildGetJwks
```

### What's going on here?

If we declare `GetJwksOptions` and `GetJwks` in the namespace, they aren't exposed when we declare `buildGetJwks` at the end. So, we declare the types outside the namespace without `export` and then export them all in the namespace.

We could accomplish the same thing by leaving the `export type`s in the namespace then, `declare function buildGetJwks(options?: buildGetJwks.GetJwksOptions): buildGetJwks.GetJwks` to reference the types in the namespace. This option felt more confusing to me, though the whole "must have a namespace" thing is confusing to begin with.

## Test to confirm nothing broke

With the declarations hacked, we're ready to confirm everything works. We're already set for ESM mode, so let's run the ESM scripts -- `esm:mjs`, `esm:ts`, and `build:esm`. They all run. The build output for looks reasonable.

```javascript
import buildGetJwks from "get-jwks";
const getJwks = buildGetJwks();
console.log(getJwks.cache);
```

Just to be sure, `node lib-esm/testTS.js` -- works.

Now let's reset for CJS mode.

- Remove `"type": "module"` in `package.json`.
- Copy `tsconfig-cjs.json` to `tsconfig.json`.

And run the CJS scripts --- `cjs:require`, `cjs:mjs`, `cjs:ts`, and `build:cjs`.

All work. The build output looks reasonable enough.

```javascript
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const get_jwks_1 = __importDefault(require("get-jwks"));
const getJwks = (0, get_jwks_1.default)();
console.log(getJwks.cache);
```

And `node lib-cjs/testTS.js` works.