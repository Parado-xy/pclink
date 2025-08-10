import 'dotenv/config';
import os from 'os';
import path from 'path';

export const CONFIG = {
  PORT: process.env.PORT || 8443,
  HOST: process.env.HOST || 'localhost',
  TOKEN: process.env.SERVER_TOKEN || 'CHANGE_ME_TOKEN',
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '524288000', 10), // 500MB
  MAX_CHUNK_SIZE: parseInt(process.env.MAX_CHUNK_SIZE || '65536', 10),
  ROOT_DIR: path.resolve(process.env.ROOT_DIR || os.homedir()), // sandbox root
  ALLOW_REMOTE_CLIPBOARD_SET: process.env.ALLOW_REMOTE_CLIPBOARD_SET === 'true',
  ALLOW_SHELL: process.env.ALLOW_SHELL === 'true',
  SHELL_WHITELIST: (process.env.SHELL_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean)
};