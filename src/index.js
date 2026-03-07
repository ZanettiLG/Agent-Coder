
const coder = require("./coder");

const main = async () => {
    const response = await coder("/ask how is this repository actual scenario? write SPEC", {workspace: "../test"});
    console.log(response);
}

main();