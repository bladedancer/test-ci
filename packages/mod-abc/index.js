const moda = require('@bladedancer/mod-a');
const modb = require('@bladedancer/mod-b');
const modc = require('@bladedancer/mod-c');
const pkg = require('./package.json');

console.log(`RELEASE: ${pkg['api-builder'].release}`);
console.log(moda);
console.log(modb);
console.log(modc);
