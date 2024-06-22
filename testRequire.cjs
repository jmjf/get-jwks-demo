const buildGetJwks = require('get-jwks');

const getJwks = buildGetJwks();

console.log(getJwks.cache);