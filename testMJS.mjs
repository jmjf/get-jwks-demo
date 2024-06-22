import buildGetJwks from "get-jwks";

const getJwks = buildGetJwks();

console.log(getJwks.cache);