export interface UploadFile {
  filename: string;
  data: Buffer;
  contentType?: string;
}

export interface UploadContext {
  baseDir: string;
  refId: string;
  gameModel: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, any>;
}

export interface UploadUIConfig {
  type: string;
  label: string;
  icon: string;
  isCard: boolean;
  supportsPrint: boolean;
  supportsDownload: boolean;
}

export interface CardExtraMeta {
  description?: string;
  dateCode?: string;
  copyright?: string;
  price?: number;
  holoName?: string;
  holoPrice?: number;
  created?: string;
  rarity?: number;
  bodyBaseId?: number;
  shinkiName?: string;
  profileName?: string;
  rawJson?: Record<string, any>;
}

export interface UploadItem {
  id: string;
  fileName: string;
  refId: string;
  gameModel: string;
  gameTitle: string;
  category: string;
  title: string;
  timestamp: number;
  uploadTime: string;
  fileSizeBytes: number;
  url: string;
  orientation: 'portrait' | 'landscape';
  dimensions?: { width: number; height: number };
  sha256?: string;
  isCard?: boolean;
  isPrinted?: boolean;
  card?: {
    cardId: string;
    subDir: string;
    frontUrl: string;
    backUrl?: string;
    holoUrl?: string;
    irUrl?: string;
    previewUrl?: string;
    hasBack: boolean;
    hasHolo: boolean;
    hasIr: boolean;
    hasFrontPrev: boolean;
    shinkiName?: string;
    profileName?: string;
    description?: string;
    extraMeta?: CardExtraMeta;
  };
  photo?: {
    accessKey?: string;
    metaXml?: Record<string, any>;
  };
}

export interface IUploadHandler {
  readonly type: string;
  readonly uiConfig: UploadUIConfig;

  matches?(gameModel: string, files?: UploadFile[]): boolean;
  saveUpload(
    ctx: UploadContext,
    files: UploadFile[]
  ): Promise<{ count: number; savedFiles: string[] }>;
  listItems(baseDir: string, gameCodes: string[], refId?: string): Promise<UploadItem[]>;
  deleteItem(baseDir: string, refId: string, itemId: string): Promise<boolean>;
  handleAction?(
    baseDir: string,
    action: string,
    refId: string,
    itemId: string,
    payload?: any
  ): Promise<any>;
}
