export interface ServiceField {
  id: string
  key: string
  label: string
  type: "text" | "secret" | "textarea" | "url" | "linked_service" | "2fa"
  masked: boolean
  required: boolean
  linkedServiceTypeId?: string
}

export interface ServiceType {
  id: string
  name: string
  icon: string
  fields: ServiceField[]
}

export interface Service {
  id: string
  serviceTypeId: string
  label: string
  data: Record<string, string>
  tags: string[]
}

export interface Account {
  id: string
  label: string
  notes: string
  tags: string[]
  linkedServices: string[]
}

export interface Settings {
    autoLockMinutes: number;
}

export interface Vault {
  version: string
  serviceTypes: ServiceType[]
  services: Service[]
  accounts: Account[]
  settings: Settings;
}

export interface BulkAccountConfig {
  count: number
  nameTemplate: string
  startNumber: number
  tags: string[]
  notes: string
}

export interface ServiceLinkConfig {
  serviceTypeId: string
  nameTemplate: string
  data: Record<string, string>
  tags: string[]
}

export interface BulkCreateRequest {
  accountConfig: BulkAccountConfig
  linkServices: boolean
  serviceConfigs: ServiceLinkConfig[]
}
