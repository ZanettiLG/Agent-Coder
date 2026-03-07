const { exec } = require("node:child_process");
const { cursorApiKey } = require("../config");

const defaultOptions = {model: "auto", debug: false, outputFormat: "json"};

const coder = async (prompt, {model="auto", debug=false, outputFormat="json", workspace} = defaultOptions) => {
    const debugFlag = debug ? " -p" : " ";
    const modelFlag = model ? ` --model "${model}"` : "";
    const outputFormatFlag = outputFormat ? ` --output-format "${outputFormat}"` : "";
    const workspaceFlag = workspace ? ` --workspace "${workspace}"` : "";
    const command = `agent --trust${debugFlag} "${prompt}"${modelFlag} --api-key "${cursorApiKey}"${outputFormatFlag}${workspaceFlag}`;
    const response = await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            }
            resolve({stdout, stderr});
        });
    });
    return response;
}

module.exports = coder;