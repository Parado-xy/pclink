export const MessageTypes = {
  AUTH: 'auth',
  ACK: 'ack',
  ERROR: 'error',
  CLIPBOARD_UPDATE: 'clipboard_update',
  CLIPBOARD_REQUEST: 'clipboard_request',
  CLIPBOARD_RESPONSE: 'clipboard_response',
  FILE_SEND_INIT: 'file_send_init',
  FILE_CHUNK: 'file_chunk',
  FILE_COMPLETE: 'file_complete',
  FILE_CANCEL: 'file_cancel',
  PRESENCE: 'presence',
  DEVICE_LIST: 'device_list',

  // Host integration
  HOST_CLIPBOARD_UPDATE: 'host_clipboard_update',
  HOST_CLIPBOARD_SET: 'host_clipboard_set',
  FS_LIST: 'fs_list',
  FS_LIST_RESULT: 'fs_list_result',
  SHELL_RUN: 'shell_run',
  SHELL_OUTPUT: 'shell_output',
  SHELL_DONE: 'shell_done'
};

export function safeParse(data) {
  try { return JSON.parse(data); } catch { return null; }
}