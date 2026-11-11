import cp from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function findChrome(): Promise<string> {
  const windowsRoots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter(
    (directory): directory is string => typeof directory === 'string' && directory.length > 0,
  );
  const names =
    process.platform === 'win32'
      ? ['chrome.exe', 'chromium.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const candidates = process.env.CHROME_PATH
    ? [path.resolve(process.env.CHROME_PATH)]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        ...windowsRoots.map((directory) =>
          path.join(directory, 'Google/Chrome/Application/chrome.exe'),
        ),
        ...(process.env.PATH ?? '')
          .split(path.delimiter)
          .flatMap((directory) => names.map((name) => path.join(directory, name))),
      ];
  const available = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await fsp.access(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        return undefined;
      }
    }),
  );
  const executable = available.find((candidate) => candidate !== undefined);
  if (executable) return executable;
  throw new Error('找不到可执行的 Chrome / Chromium，请通过 CHROME_PATH 指定浏览器可执行文件。');
}

async function pack(): Promise<void> {
  const chrome = await findChrome();
  const keyFile = path.resolve(process.env.CRX_KEY_PATH ?? '.keys/pip-any.pem');
  const output = path.resolve('release/pip-any.crx');
  const hasKey = await exists(keyFile);
  if (process.env.CRX_KEY_PATH && !hasKey) {
    throw new Error('CRX_KEY_PATH 指定的私钥不存在，请指定已有私钥文件。');
  }
  if (!hasKey && (await exists(output))) {
    throw new Error('CRX 已存在但签名私钥缺失，请先恢复 .keys/pip-any.pem，避免改变扩展 ID。');
  }
  await fsp.access('dist/manifest.json');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'pip-any-crx-'));
  const staging = path.join(temporary, 'extension');
  const partialOutput = path.join(path.dirname(output), `.pip-any-${process.pid}.crx.tmp`);
  try {
    await fsp.cp('dist', staging, { recursive: true });
    const args = [
      `--user-data-dir=${path.join(temporary, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-message-box',
      `--pack-extension=${staging}`,
    ];
    if (hasKey) args.push(`--pack-extension-key=${keyFile}`);
    await new Promise<void>((resolve, reject) => {
      cp.execFile(chrome, args, { timeout: 60_000 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(`Chrome 打包失败：${stderr.trim() || error.message}`));
        else resolve();
      });
    });
    const crx = await fsp.readFile(`${staging}.crx`);
    if (crx.length < 12 || crx.subarray(0, 4).toString() !== 'Cr24' || crx.readUInt32LE(4) !== 3) {
      throw new Error('Chrome 未生成有效的 CRX3 文件。');
    }
    if (!hasKey) {
      await fsp.mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
      // 首次保存只允许新建，避免并行打包时覆盖另一份签名身份。
      await fsp.copyFile(`${staging}.pem`, keyFile, fs.constants.COPYFILE_EXCL);
      await fsp.chmod(keyFile, 0o600);
    }
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.writeFile(partialOutput, crx);
    await fsp.rename(partialOutput, output);
    console.log(`CRX 已生成：${output}`);
    console.log(`签名私钥：${keyFile}（请妥善备份，不要随包分发）`);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
    await fsp.rm(partialOutput, { force: true });
  }
}

try {
  await pack();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CRX 打包失败。');
  process.exitCode = 1;
}
