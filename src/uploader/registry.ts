import { IUploadHandler, UploadFile } from './types';
import { CardConnectHandler } from './handlers/card_connect';
import { EAGatePhotoHandler } from './handlers/eagate_photo';

class UploadHandlerRegistry {
  private handlers = new Map<string, IUploadHandler>();
  private gameCodeMap = new Map<string, string>();

  constructor() {
    this.register(new CardConnectHandler());
    this.register(new EAGatePhotoHandler());

    this.bindGameCode('TBS', 'card_connect');
    this.bindGameCode('CC', 'card_connect');
    this.bindGameCode('KLP', 'eagate_photo');
  }

  register(handler: IUploadHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): IUploadHandler | null {
    return this.handlers.get(type) || null;
  }

  bindGameCode(gameCode: string, handlerType: string): void {
    this.gameCodeMap.set(gameCode.toUpperCase(), handlerType);
  }

  getHandlerForGame(gameModelOrCode?: string, files?: UploadFile[]): IUploadHandler {
    const raw = (gameModelOrCode || '').toUpperCase().trim();
    const clean = raw.split(':')[0] || raw.substring(0, 3);

    if (clean) {
      for (const [code, type] of this.gameCodeMap.entries()) {
        if (clean.startsWith(code)) {
          const h = this.get(type);
          if (h) return h;
        }
      }
    }

    for (const h of this.handlers.values()) {
      if (h.matches && h.matches(raw, files)) {
        return h;
      }
    }

    return this.getDefaultHandler();
  }

  getHandlerForPlugin(plugin: { GameCodes?: string[]; UploadType?: string }): IUploadHandler {
    if (plugin.UploadType && this.handlers.has(plugin.UploadType)) {
      return this.handlers.get(plugin.UploadType)!;
    }

    const codes = plugin.GameCodes || [];
    for (const code of codes) {
      const clean = code.toUpperCase().trim();
      for (const [prefix, type] of this.gameCodeMap.entries()) {
        if (clean.startsWith(prefix)) {
          const h = this.get(type);
          if (h) return h;
        }
      }
    }

    return this.getDefaultHandler();
  }

  getDefaultHandler(): IUploadHandler {
    return this.handlers.get('eagate_photo') || this.handlers.values().next().value;
  }

  getAllHandlers(): IUploadHandler[] {
    return Array.from(this.handlers.values());
  }
}

export const uploadRegistry = new UploadHandlerRegistry();
