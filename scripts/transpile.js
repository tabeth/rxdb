process.env['NODE_ENV'] = 'es5';

console.log('# transpiling.. (this takes some time on first run)');
require('events').EventEmitter.defaultMaxListeners = 0;

/**
 * runs the babel-transpile
 * remembers mtime of files and only transpiles the changed ones
 */
const nconf = require('nconf');
const path = require('path');
const fs = require('fs');
const walkSync = require('walk-sync');
const shell = require('shelljs');
const del = require('delete');
const existsFile = require('exists-file');
const basePath = path.join(__dirname, '..');

const confLocation = path.join(basePath, '.transpile_state.json');

const DEBUG = false;

/**
 * key->value | src -> compiled
 */
const transpileFolders = {
    'src': 'dist/lib',
    'test': 'test_tmp'
};

nconf.argv()
    .env()
    .file({
        file: confLocation
    });



async function transpileFile(srcLocation, goalLocation) {
    DEBUG && console.log('transpile: ' + srcLocation);
    // ensure folder exists
    const folder = path.join(goalLocation, '..');
    if (!fs.existsSync(folder)) shell.mkdir('-p', folder);

    await del.promise([goalLocation]);
    const cmd = 'babel ' +
        srcLocation +
        ' --source-maps' +
        ' --extensions ".ts,.js"' +
        ' --out-file ' +
        goalLocation;
    DEBUG && console.dir(cmd);

    const execRes = shell.exec(cmd, {
        async: true
    });
    await new Promise(res => execRes.on('exit', res));

    const exitCode = execRes.exitCode;
    if (exitCode !== 0) {
        console.error('transpiling ' + srcLocation + ' failed');
        process.exit(1);
    }

    if (DEBUG) console.log('transpiled: ' + srcLocation);

    return;
}

const files = Object.entries(transpileFolders)
    .map(entry => entry.map(folder => path.join(basePath, folder)))
    .map(entry => {
        const srcFolder = entry[0];
        const toFolder = entry[1];
        return walkSync.entries(srcFolder)
            .map(fileEntry => {

                // ensure goal-file-ending is .js
                const relativePathSplit = fileEntry.relativePath.split('.');
                relativePathSplit.pop();
                relativePathSplit.push('js');

                fileEntry.goalPath = path.join(toFolder, relativePathSplit.join('.'));
                return fileEntry;
            });
    })
    .reduce((pre, cur) => pre.concat(cur), [])
    .filter(entry => !entry.isDirectory())
    .filter(entry => entry.relativePath.endsWith('.js') || entry.relativePath.endsWith('.ts'))
    .map(entry => {
        entry.fullPath = path.join(entry.basePath, entry.relativePath);
        entry.lastTime = nconf.get(entry.fullPath);
        return entry;
    })
    .filter(entry => entry.lastTime !== entry.mtime || !existsFile.sync(entry.goalPath));

DEBUG && console.dir(files);

const resolved = Promise.resolve();
Promise.all(files
    .map(fileEntry => {
        if (fileEntry.relativePath.includes('/node_modules/')) {
            // skip node modules of examples or tests
            return resolved;
        }

        return transpileFile(
            path.join(fileEntry.basePath, fileEntry.relativePath),
            fileEntry.goalPath
        ).then(() => {
            nconf.set(fileEntry.fullPath, fileEntry.mtime);
        });
    }))
    .then(() => {
        nconf.save(function () {
            DEBUG && console.log('conf saved');
            console.log('# transpiling DONE');
        });
    });
