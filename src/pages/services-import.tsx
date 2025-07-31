"use client"

import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { useVaultStore } from "@/stores/vault-store"
import { toast } from "sonner"
import type { Service } from "@/types"
import { v4 as uuidv4 } from 'uuid'
import { ArrowLeft, Upload, CornerDownLeft, Check, X, Loader2 } from "lucide-react"

export default function ServicesImport() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { vault, addServices } = useVaultStore()
  const serviceTypes = vault?.serviceTypes || []
  
  const [importData, setImportData] = useState<string>("")
  const [separator, setSeparator] = useState<string>("||")
  const [header, setHeader] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({})
  const [primaryServiceTypeId, setPrimaryServiceTypeId] = useState<string>("")
  const [isImporting, setIsImporting] = useState(false)

  const [labelStrategy, setLabelStrategy] = useState<'map' | 'generate'>('map');
  const [labelMapColumn, setLabelMapColumn] = useState<number | null>(null);
  const [labelPattern, setLabelPattern] = useState('ACC');
  const [labelStartNumber, setLabelStartNumber] = useState(1);


  const primaryServiceType = useMemo(() => {
    return serviceTypes.find((st) => st.id === primaryServiceTypeId)
  }, [primaryServiceTypeId, serviceTypes])

  const handleDataChange = (data: string) => {
    setImportData(data)
    const lines = data.trim().split('\n').filter(line => line.length > 0)
    if (lines.length > 0) {
      const firstLine = lines[0].split(separator)
      setHeader(firstLine.map((_, index) => `Column ${index + 1}`))
      setRows(lines.map(line => line.split(separator)))
    } else {
      setHeader([])
      setRows([])
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0]
      const text = await file.text()
      handleDataChange(text)
    }
  }
  
  const handleColumnMappingChange = (columnIndex: number, value: string) => {
    setColumnMapping(prev => ({ ...prev, [columnIndex]: value }))
  }

  const handleImport = async () => {
    if (!primaryServiceTypeId || !primaryServiceType) {
      toast.error(t('services.import.errors.select_main_type'))
      return
    }
    if (labelStrategy === 'map' && labelMapColumn === null) {
        toast.error(t('services.import.errors.select_label_column'))
        return
    }

    setIsImporting(true)
    
    let localSkippedCount = 0
    const allServices = [...(vault?.services || [])]
    const servicesToAdd: Service[] = []

    let nextGeneratedNumber = labelStartNumber;
    if (labelStrategy === 'generate') {
        const existingPatternServices = allServices
            .filter(s => s.label.startsWith(labelPattern))
            .map(s => parseInt(s.label.substring(labelPattern.length), 10))
            .filter(n => !isNaN(n));
        
        if (existingPatternServices.length > 0) {
            nextGeneratedNumber = Math.max(...existingPatternServices) + 1;
        }
    }


    for (const [rowIndex, row] of rows.entries()) {
        let isRowValid = true;
        const newServiceData: Record<string, string> = {};
        let newServiceLabel: string = '';
        let newServiceTags: string[] = [];

        if (labelStrategy === 'map') {
            if (labelMapColumn !== null && row[labelMapColumn]) {
                newServiceLabel = row[labelMapColumn];
            } else {
                localSkippedCount++;
                continue;
            }
        } else { // generate
            newServiceLabel = `${labelPattern}${nextGeneratedNumber + servicesToAdd.length}`;
        }
        
        const fieldsToResolve: { fieldKey: string, linkedServiceTypeId: string, lookupValue: string }[] = [];

        for (const [colIndex, cellValue] of row.entries()) {
            if (labelStrategy === 'map' && colIndex === labelMapColumn) continue;

            const mapping = columnMapping[colIndex];
            if (!mapping || mapping === 'ignore' || !cellValue) continue;

            const [mapType, , fieldKey] = mapping.split('-');

            if (mapType === 'tags') {
                newServiceTags = cellValue.split(',').map(t => t.trim());
            } else if (mapType === 'field') {
                const fieldDefinition = primaryServiceType.fields.find(f => f.key === fieldKey);
                if (fieldDefinition?.type === 'linked_service' && fieldDefinition.linkedServiceTypeId) {
                    fieldsToResolve.push({ 
                        fieldKey: fieldKey, 
                        linkedServiceTypeId: fieldDefinition.linkedServiceTypeId, 
                        lookupValue: cellValue 
                    });
                } else {
                    newServiceData[fieldKey] = cellValue;
                }
            }
        }

        for (const { fieldKey, linkedServiceTypeId, lookupValue } of fieldsToResolve) {
            const linkedServiceType = serviceTypes.find(st => st.id === linkedServiceTypeId);

            const targetFieldExists = linkedServiceType?.fields.some(f => f.key === fieldKey);

            if (!linkedServiceType || !targetFieldExists) {
                isRowValid = false;
                break;
            }

            const foundService = allServices.find(s => 
                s.serviceTypeId === linkedServiceTypeId && s.data[fieldKey] === lookupValue
            );

            if (foundService) {
                newServiceData[fieldKey] = foundService.id;
            } else {
                isRowValid = false;
                break;
            }
        }
        
        if (!isRowValid) {
            localSkippedCount++;
            continue;
        }
        
        const isDuplicate = allServices.some(s => s.label === newServiceLabel && s.serviceTypeId === primaryServiceTypeId) ||
                            servicesToAdd.some(s => s.label === newServiceLabel && s.serviceTypeId === primaryServiceTypeId);
        if (isDuplicate) {
            localSkippedCount++;
            continue;
        }

        const newService: Service = {
            id: uuidv4(),
            label: newServiceLabel,
            serviceTypeId: primaryServiceTypeId,
            tags: newServiceTags,
            data: newServiceData,
        };
        
        servicesToAdd.push(newService);
    }
    
    if (servicesToAdd.length > 0) {
        try {
            await addServices(servicesToAdd);
        } catch (error) {
            toast.error("Failed to import services.");
            setIsImporting(false);
            return;
        }
    }

    toast.success(t('services.import.success_toast_v2', {
        count: servicesToAdd.length,
        skipped: localSkippedCount 
    }), {
        description: t('services.import.skipped_description'),
    });

    setIsImporting(false);

    if (servicesToAdd.length > 0) {
      navigate('/services');
    }
  }
  
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-white">{t('services.import.title')}</h1>
          <p className="text-gray-400">{t('services.import.description')}</p>
        </div>
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle>{t('services.import.step1_title')}</CardTitle>
          <CardDescription>{t('services.import.step1_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="file-upload" className="text-gray-300 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                {t('services.import.upload_file')}
              </Label>
              <Input id="file-upload" type="file" onChange={handleFileChange} className="bg-gray-700 border-gray-600 text-white" accept=".csv,.txt" disabled={isImporting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="separator" className="text-gray-300">
                {t('services.import.separator')}
              </Label>
              <Input id="separator" value={separator} onChange={(e) => setSeparator(e.target.value)} className="bg-gray-700 border-gray-600 text-white" disabled={isImporting} />
            </div>
          </div>
          <div className="relative">
            {!importData && (
                <div className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400 text-sm flex items-center pointer-events-none">
                    <CornerDownLeft className="w-3 h-3 mr-1" />
                    <span>{t('services.import.paste_data_label')}</span>
                </div>
            )}
            <Textarea
              placeholder=""
              value={importData}
              onChange={(e) => handleDataChange(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white h-48"
              disabled={isImporting}
            />
          </div>
        </CardContent>
      </Card>
      
      {rows.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle>{t('services.import.step2_title')}</CardTitle>
            <CardDescription>{t('services.import.step2_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
             <div className="space-y-2">
                <Label className="text-gray-300">{t('services.import.main_service_type')}</Label>
                <Select value={primaryServiceTypeId} onValueChange={setPrimaryServiceTypeId} disabled={isImporting}>
                    <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                        <SelectValue placeholder={t('services.import.select_main_type_placeholder')} />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-700 border-gray-600 text-white">
                        {serviceTypes.map(st => (
                            <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
             </div>

            {primaryServiceTypeId && (
                <>
                <div className="space-y-4 p-4 border border-gray-700 rounded-lg">
                    <Label className="text-lg font-semibold text-white">{t('services.import.label_generation_title')}</Label>
                    <RadioGroup value={labelStrategy} onValueChange={(v) => setLabelStrategy(v as 'map' | 'generate')} disabled={isImporting}>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="map" id="map" />
                            <Label htmlFor="map">{t('services.import.label_strat_map')}</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="generate" id="generate" />
                            <Label htmlFor="generate">{t('services.import.label_strat_generate')}</Label>
                        </div>
                    </RadioGroup>

                    {labelStrategy === 'map' && (
                        <div className="space-y-2 pl-6">
                             <Label>{t('services.import.label_map_column')}</Label>
                             <Select onValueChange={(v) => setLabelMapColumn(parseInt(v, 10))} disabled={isImporting}>
                                <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                                    <SelectValue placeholder={t('services.import.select_column_placeholder')} />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600 text-white">
                                    {header.map((col, index) => (
                                        <SelectItem key={index} value={String(index)}>{col}</SelectItem>
                                    ))}
                                </SelectContent>
                             </Select>
                        </div>
                    )}
                    {labelStrategy === 'generate' && (
                        <div className="grid grid-cols-2 gap-4 pl-6">
                            <div className="space-y-2">
                                <Label htmlFor="pattern">{t('services.import.pattern')}</Label>
                                <Input id="pattern" value={labelPattern} onChange={(e) => setLabelPattern(e.target.value)} className="bg-gray-700 border-gray-600 text-white" disabled={isImporting} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="startNumber">{t('services.import.start_number')}</Label>
                                <Input id="startNumber" type="number" value={labelStartNumber} onChange={(e) => setLabelStartNumber(parseInt(e.target.value, 10) || 1)} className="bg-gray-700 border-gray-600 text-white" disabled={isImporting} />
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {header.map((col, index) => {
                        if (labelStrategy === 'map' && index === labelMapColumn) return null;
                        return (
                        <div key={index} className="space-y-2">
                        <Label className="text-gray-300">{col}</Label>
                        <Select value={columnMapping[index] || 'ignore'} onValueChange={(value) => handleColumnMappingChange(index, value)} disabled={isImporting}>
                            <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder={t('services.import.select_field')} />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-700 border-gray-600 text-white max-h-80">
                                <SelectItem value="ignore">{t('services.fields.ignore')}</SelectItem>
                                <SelectItem value={`tags-${primaryServiceTypeId}-tags`}>
                                    {t('services.fields.tags')}
                                </SelectItem>
                                <SelectGroup>
                                    <SelectLabel>{primaryServiceType?.name}</SelectLabel>
                                    {primaryServiceType?.fields.map(field => (
                                        <SelectItem key={field.id} value={`field-${primaryServiceTypeId}-${field.key}`}>
                                            {field.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        </div>
                    )})}
                </div>
                </>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && primaryServiceTypeId && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle>{t('services.import.step3_title')}</CardTitle>
             <CardDescription>{t('services.import.step3_desc')}</CardDescription>
           </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-700">
                  <tr className="text-left">
                    {header.map((col, index) => (
                      <th key={index} className="p-2 text-gray-300 font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-gray-700 hover:bg-gray-750">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="p-2 text-white truncate max-w-xs">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
             <Button variant="outline" onClick={() => navigate(-1)} disabled={isImporting}>
                <X className="w-4 h-4 mr-2" />
                {t('common.cancel')}
             </Button>
             <Button className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800" onClick={handleImport} disabled={isImporting}>
                {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {t('services.import.confirm_import')}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
