export interface ServiceField {
  id: string
  key: string
  label: string
  type: "text" | "secret" | "textarea" | "url" | "linked_service"
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
