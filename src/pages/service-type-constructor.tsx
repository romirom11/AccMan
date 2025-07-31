"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirm } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, GripVertical, Trash2, Save, Pencil, X } from "lucide-react";
import { useVaultStore } from "../stores/vault-store";
import type { ServiceType, ServiceField } from "../types";

export default function ServiceTypeConstructor() {
  const { t } = useTranslation();
  const { addServiceType, updateServiceType, deleteServiceType } = useVaultStore();
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [editingType, setEditingType] = useState<ServiceType | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const serviceTypes = useVaultStore((state) => state.vault?.serviceTypes || []);
  const selectedType = serviceTypes.find((type) => type.id === selectedTypeId);

  const startCreating = () => {
    const newType: ServiceType = { id: "", name: "", icon: "Server", fields: [] };
    setEditingType(newType);
    setIsCreating(true);
    setSelectedTypeId("");
  };

  const startEditing = (type: ServiceType) => {
    setEditingType(JSON.parse(JSON.stringify(type))); // Deep copy
    setIsCreating(false);
  };

  const addField = () => {
    if (!editingType) return;
    const newField: ServiceField = {
      id: crypto.randomUUID(),
      key: "",
      label: "",
      type: "text",
      masked: false,
      required: false,
    };
    setEditingType({ ...editingType, fields: [...editingType.fields, newField] });
  };

  const updateField = (fieldId: string, updates: Partial<ServiceField>) => {
    if (!editingType) return;
    setEditingType({
      ...editingType,
      fields: editingType.fields.map((field) => (field.id === fieldId ? { ...field, ...updates } : field)),
    });
  };

  const removeField = (fieldId: string) => {
    if (!editingType) return;
    setEditingType({
      ...editingType,
      fields: editingType.fields.filter((field) => field.id !== fieldId),
    });
  };

  const generateKey = (label: string) => {
    return label.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_");
  };

  const handleSave = async () => {
    if (!editingType || !editingType.name.trim() || !editingType.id.trim()) {
      toast.error(t('service_type_constructor.errors.name_id_required'));
      return;
    }
    
    const action = isCreating ? addServiceType(editingType) : updateServiceType(editingType);

    await action.then(() => {
      if (isCreating) {
        setSelectedTypeId(editingType.id);
      }
      setEditingType(null);
      setIsCreating(false);
    });
  };

  const handleDelete = async (typeId: string) => {
    const confirmed = await confirm(t('service_type_constructor.delete_confirm.message'), {
      title: t('service_type_constructor.delete_confirm.title'),
    });

    if (confirmed) {
      await deleteServiceType(typeId).then(() => {
        if (selectedTypeId === typeId) {
          setSelectedTypeId("");
        }
      });
    }
  }

  return (
    <div className="p-6">
      <div className="flex gap-6 h-[calc(100vh-8rem)]">
        {/* Left Panel */}
        <Card className="w-80 bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">{t('service_type_constructor.list_title')}</CardTitle>
              <Button size="sm" onClick={startCreating} className="bg-gradient-to-r from-blue-600 to-purple-700">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {serviceTypes.map((type) => (
              <div
                key={type.id}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedTypeId === type.id ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
                onClick={() => {
                  setSelectedTypeId(type.id);
                  setEditingType(null);
                  setIsCreating(false);
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{type.name}</span>
                   <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); startEditing(type); }} className="text-gray-400 hover:text-white">
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
                <div className="text-sm opacity-75 mt-1">{t('service_type_constructor.fields_count', { count: type.fields.length })}</div>
              </div>
            ))}
            {serviceTypes.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">{t('service_type_constructor.no_types')}</p>
                <Button size="sm" onClick={startCreating} className="mt-2 bg-gradient-to-r from-blue-600 to-purple-700">
                  {t('service_type_constructor.create_first')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Panel */}
        <Card className="flex-1 bg-gray-800 border-gray-700 flex flex-col overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">
                {editingType ? (isCreating ? t('service_type_constructor.creating_title') : t('service_type_constructor.editing_title')) : t('service_type_constructor.main_title')}
              </CardTitle>
              {editingType && (
                <div className="flex gap-2">
                  <Button className="bg-gray-700 border-gray-600 text-gray-300" onClick={() => { setEditingType(null); setIsCreating(false); }}>
                    <X className="w-4 h-4" />
                  </Button>
                  <Button onClick={handleSave} className="bg-gradient-to-r from-blue-600 to-purple-700">
                    <Save className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6 overflow-y-auto">
            {editingType ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="typeName" className="text-gray-300">{t('service_type_constructor.form.type_name')}</Label>
                    <Input id="typeName" value={editingType.name} onChange={(e) => { const name = e.target.value; setEditingType({ ...editingType, name, id: isCreating ? generateKey(name) : editingType.id }); }} placeholder="Discord Account" className="bg-gray-700 border-gray-600 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="typeId" className="text-gray-300">{t('service_type_constructor.form.system_name')}</Label>
                    <Input id="typeId" value={editingType.id} onChange={(e) => setEditingType({ ...editingType, id: e.target.value })} placeholder="discord-account" className="bg-gray-700 border-gray-600 text-white font-mono" readOnly={!isCreating} />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-gray-300 text-lg">{t('service_type_constructor.form.fields_title')}</Label>
                    <Button onClick={addField} size="sm" className="bg-gradient-to-r from-blue-600 to-purple-700">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {editingType.fields.map((field) => (
                      <Card key={field.id} className="bg-gray-700 border-gray-600">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <div className="mt-2"><GripVertical className="w-5 h-5 text-gray-400 cursor-move" /></div>
                            <div className="flex-1 grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label className="text-gray-300 text-sm">{t('service_type_constructor.form.field_name')}</Label>
                                <Input value={field.label} onChange={(e) => { const label = e.target.value; updateField(field.id, { label, key: generateKey(label) }); }} placeholder={t('service_type_constructor.form.field_name_placeholder')} className="bg-gray-600 border-gray-500 text-white" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-gray-300 text-sm">{t('service_type_constructor.form.key')}</Label>
                                <Input value={field.key} onChange={(e) => updateField(field.id, { key: e.target.value })} placeholder="login" className="bg-gray-600 border-gray-500 text-white font-mono" />
                              </div>
                              <div className="space-y-2 col-span-2">
                                <Label className="text-gray-300 text-sm">{t('service_type_constructor.form.type')}</Label>
                                <Select value={field.type} onValueChange={(value: ServiceField['type']) => updateField(field.id, { type: value })}>
                                  <SelectTrigger className="bg-gray-600 border-gray-500 text-white"><SelectValue /></SelectTrigger>
                                  <SelectContent className="bg-gray-600 border-gray-500">
                                    <SelectItem value="text">{t('service_type_constructor.field_types.text')}</SelectItem>
                                    <SelectItem value="secret">{t('service_type_constructor.field_types.secret')}</SelectItem>
                                    <SelectItem value="textarea">{t('service_type_constructor.field_types.textarea')}</SelectItem>
                                    <SelectItem value="url">URL</SelectItem>
                                    <SelectItem value="linked_service">{t('service_type_constructor.field_types.linked_service')}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {field.type === 'linked_service' && (
                                <div className="space-y-2 col-span-2">
                                  <Label className="text-gray-300 text-sm">{t('service_type_constructor.form.linked_service_type')}</Label>
                                   <Select value={field.linkedServiceTypeId} onValueChange={(value: string) => updateField(field.id, { linkedServiceTypeId: value })}>
                                      <SelectTrigger className="bg-gray-600 border-gray-500 text-white"><SelectValue placeholder={t('service_type_constructor.form.select_type_placeholder')}/></SelectTrigger>
                                      <SelectContent className="bg-gray-600 border-gray-500">
                                        {serviceTypes.map(st => (<SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                </div>
                              )}
                              <div className="space-y-3 col-span-2 grid grid-cols-2">
                                <div className="flex items-center space-x-2">
                                  <Checkbox id={`required-${field.id}`} checked={field.required} onCheckedChange={(checked) => updateField(field.id, { required: !!checked })} />
                                  <Label htmlFor={`required-${field.id}`} className="text-gray-300 text-sm">{t('service_type_constructor.form.required')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Checkbox id={`masked-${field.id}`} checked={field.masked} onCheckedChange={(checked) => updateField(field.id, { masked: !!checked })} />
                                  <Label htmlFor={`masked-${field.id}`} className="text-gray-300 text-sm">{t('service_type_constructor.form.masked')}</Label>
                                </div>
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => removeField(field.id)} className="text-gray-400 hover:text-red-400 mt-2">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {editingType.fields.length === 0 && (
                      <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-600 rounded-lg">
                        <p>{t('service_type_constructor.form.no_fields')}</p>
                        <p className="text-sm">{t('service_type_constructor.form.no_fields_description')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : selectedType ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedType.name}</h2>
                    <p className="text-gray-400">ID: {selectedType.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                  <Button onClick={() => startEditing(selectedType)} className="bg-gradient-to-r from-blue-600 to-purple-700">{t('common.edit')}</Button>
                   <Button size="sm" variant="ghost" onClick={(e) => { if (selectedType) { e.stopPropagation(); handleDelete(selectedType.id); } }} className="text-gray-400 hover:text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-medium text-white">{t('service_type_constructor.form.fields_title')} ({selectedType.fields.length})</h3>
                  {selectedType.fields.map((field) => (
                    <Card key={field.id} className="bg-gray-700 border-gray-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-white">{field.label}</h4>
                            <p className="text-sm text-gray-400">
                              {field.key} • {field.type}
                              {field.type === 'linked_service' && ` -> ${serviceTypes.find(st => st.id === field.linkedServiceTypeId)?.name || '???'}`}
                              {field.required && ` • ${t('service_type_constructor.form.required').toLowerCase()}`}
                              {field.masked && ` • ${t('service_type_constructor.form.masked').toLowerCase()}`}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <div className="w-16 h-16 bg-gray-700 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Plus className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium mb-2">{t('service_type_constructor.main_title')}</h3>
                <p className="text-sm mb-4">{t('service_type_constructor.welcome_description')}</p>
                <Button onClick={startCreating} className="bg-gradient-to-r from-blue-600 to-purple-700">{t('service_type_constructor.create_button')}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
