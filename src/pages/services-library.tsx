"use client"

import { useState, useMemo, useEffect } from "react"
import { useTranslation } from "react-i18next"
import Fuse from "fuse.js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, Search, Filter, Grid, List, Edit, Trash2, Link, Upload, Import, MousePointer, CheckSquare, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { useVaultStore } from "../stores/vault-store";
import { toast } from "sonner";
import type { Service } from "../types"
import { CreateServiceModal } from "@/components/create-service-modal"
import { BulkLinkServicesModal } from "@/components/bulk-link-services-modal"
import { confirm } from "@tauri-apps/plugin-dialog"

export default function ServicesLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { vault, deleteService, deleteServices, servicesViewMode, setServicesViewMode } = useVaultStore()
  const viewMode = servicesViewMode;
  const setViewMode = setServicesViewMode;
  const [searchQuery, setSearchQuery] = useState(() => {
    return localStorage.getItem('services-search-query') || ''
  })
  const [selectedType, setSelectedType] = useState<string>(() => {
    return localStorage.getItem('services-selected-type') || 'all'
  })
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
  const [serviceToEdit, setServiceToEdit] = useState<Service | null>(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'none'>(() => {
    return (localStorage.getItem('services-sort-order') as 'asc' | 'desc' | 'none') || 'asc'
  })
  const [sortBy, setSortBy] = useState<'name' | 'type'>(() => {
    return (localStorage.getItem('services-sort-by') as 'name' | 'type') || 'name'
  })


  const services = vault?.services || []
  const serviceTypes = vault?.serviceTypes || []

  // Handle edit service from navigation state
  useEffect(() => {
    const state = location.state as { editServiceId?: string } | null;
    if (state?.editServiceId) {
      const serviceToEdit = services.find(s => s.id === state.editServiceId);
      if (serviceToEdit) {
        setServiceToEdit(serviceToEdit);
        setIsCreateModalOpen(true);
      }
      // Clear the state to prevent reopening on refresh
      navigate(location.pathname, { replace: true });
    }
  }, [location.state, services, navigate, location.pathname])

  // Save search query to localStorage
  useEffect(() => {
    localStorage.setItem('services-search-query', searchQuery)
  }, [searchQuery])

  // Save selected type to localStorage
  useEffect(() => {
    localStorage.setItem('services-selected-type', selectedType)
  }, [selectedType])

  // Save sort order to localStorage
  useEffect(() => {
    localStorage.setItem('services-sort-order', sortOrder)
  }, [sortOrder])

  // Save sort by to localStorage
  useEffect(() => {
    localStorage.setItem('services-sort-by', sortBy)
  }, [sortBy])

  // Natural sort function for handling numbers in strings
  const naturalSort = (a: string, b: string) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  const handleSortToggle = () => {
    if (sortOrder === 'none') {
      setSortOrder('asc')
    } else if (sortOrder === 'asc') {
      setSortOrder('desc')
    } else {
      setSortOrder('none')
    }
  }

  const handleSortByChange = (newSortBy: 'name' | 'type') => {
    setSortBy(newSortBy)
  }

  const getServiceType = (serviceTypeId: string) => {
    return serviceTypes.find((type) => type.id === serviceTypeId)
  }

  const fuse = useMemo(() => new Fuse(services, {
    keys: ['label', 'tags'],
    threshold: 0.3,
    includeScore: true,
  }), [services]);

  const filteredServices = useMemo(() => {
    let results = services;

    if (searchQuery) {
        results = fuse.search(searchQuery).map(result => result.item);
    }
    
    if (selectedType !== 'all') {
        results = results.filter(service => service.serviceTypeId === selectedType);
    }

    // Apply sorting
    if (sortOrder !== 'none') {
      results = [...results].sort((a, b) => {
        let comparison = 0;
        
        if (sortBy === 'name') {
          comparison = naturalSort(a.label, b.label);
        } else if (sortBy === 'type') {
          const typeA = getServiceType(a.serviceTypeId)?.name || '';
          const typeB = getServiceType(b.serviceTypeId)?.name || '';
          comparison = naturalSort(typeA, typeB);
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    return results;
  }, [services, searchQuery, selectedType, fuse, sortOrder, sortBy, serviceTypes]);

  const toggleServiceSelection = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId],
    )
  }

  const handleServiceClick = (serviceId: string) => {
    if (isSelectionMode) {
      toggleServiceSelection(serviceId)
    } else {
      navigate(`/services/${serviceId}`)
    }
  }
  
  const handleAddService = () => {
    setServiceToEdit(null)
    setIsCreateModalOpen(true)
  }

  const handleEditService = (service: Service) => {
    setServiceToEdit(service)
    setIsCreateModalOpen(true)
  }

  const handleDeleteService = async (serviceId: string) => {
    const confirmed = await confirm(t('services.delete_confirm.message'), {
        title: t('services.delete_confirm.title')
    });
    if (confirmed) {
        await deleteService(serviceId);
    }
  }

  const handleDeleteSelected = async () => {
    const confirmed = await confirm(t('services.delete_selected_confirm.message', { count: selectedServices.length }), {
        title: t('services.delete_selected_confirm.title')
    });
    if (confirmed) {
        await deleteServices(selectedServices);
        toast.success(t('api.success.services_deleted', { count: selectedServices.length }));
        setSelectedServices([]);
        setIsSelectionMode(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{t('services.title')}</h1>
          <p className="text-gray-400">{t('services.description')}</p>
        </div>
        <div className="flex items-center gap-2">
            <Button
                variant="outline"
                className="text-white border-gray-600 hover:bg-gray-700 hover:text-white"
                onClick={() => navigate('/services-import')}
            >
                <Import className="w-4 h-4 mr-2" />
                {t('services.import_button', 'Import')}
            </Button>
            <Button 
                className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
                onClick={handleAddService}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('services.add_button')}
            </Button>
        </div>
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={t('services.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder={t('services.filter_placeholder')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value="all">{t('services.all_types')}</SelectItem>
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button
                variant={isSelectionMode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode)
                  if (!isSelectionMode) {
                    setSelectedServices([])
                  }
                }}
                className={isSelectionMode ? "bg-green-600 hover:bg-green-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
                title={isSelectionMode ? "Вимкнути режим виділення" : "Увімкнути режим виділення"}
              >
                {isSelectionMode ? <CheckSquare className="w-4 h-4" /> : <MousePointer className="w-4 h-4" />}
              </Button>
              <div className="w-px h-6 bg-gray-600" />
              
              {/* Sort by selector */}
              <Select value={sortBy} onValueChange={handleSortByChange}>
                <SelectTrigger className="w-32 bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="name">{t('services.sort.by_name', 'По імені')}</SelectItem>
                  <SelectItem value="type">{t('services.sort.by_type', 'По типу')}</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Sort order button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSortToggle}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
                title={
                  sortOrder === 'none' ? t('services.sort.no_sort', 'Без сортування') :
                  sortOrder === 'asc' ? t('services.sort.ascending', 'За зростанням') :
                  t('services.sort.descending', 'За спаданням')
                }
              >
                {sortOrder === 'none' && <ArrowUpDown className="w-4 h-4" />}
                {sortOrder === 'asc' && <ArrowUp className="w-4 h-4" />}
                {sortOrder === 'desc' && <ArrowDown className="w-4 h-4" />}
              </Button>
              
              <div className="w-px h-6 bg-gray-600" />
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className={viewMode === "grid" ? "bg-blue-600 hover:bg-blue-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "table" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("table")}
                className={viewMode === "table" ? "bg-blue-600 hover:bg-blue-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedServices.length > 0 && (
        <Card className="bg-blue-900 border-blue-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-white">{t('services.selected_count', { count: selectedServices.length })}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-blue-600 text-blue-300 bg-transparent" onClick={() => setIsLinkModalOpen(true)}>
                  <Link className="w-4 h-4 mr-2" />
                  {t('services.link_to_account')}
                </Button>
                <Button size="sm" variant="outline" className="border-red-600 text-red-300 bg-transparent" onClick={handleDeleteSelected}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => {
            const serviceType = getServiceType(service.serviceTypeId)
            const isSelected = selectedServices.includes(service.id)

            return (
              <Card
                key={service.id}
                className={`bg-gray-800 border-gray-700 cursor-pointer transition-all hover:bg-gray-750 ${
                  isSelected ? "ring-2 ring-blue-500" : ""
                }`}
                onClick={() => handleServiceClick(service.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold">{serviceType?.name.charAt(0) || "S"}</span>
                      </div>
                      <div>
                        <CardTitle className="text-white text-lg">{service.label}</CardTitle>
                        <p className="text-gray-400 text-sm">{serviceType?.name}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white" onClick={(e) => { e.stopPropagation(); handleEditService(service); }}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); handleDeleteService(service.id); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {service.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="bg-gray-700 text-gray-300">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-700">
                  <tr>
                    <th className="p-2 w-8"><Checkbox checked={selectedServices.length === filteredServices.length && filteredServices.length > 0} onCheckedChange={(checked) => setSelectedServices(checked ? filteredServices.map(s => s.id) : [])} /></th>
                    <th className="text-left p-4 text-gray-300 font-medium">{t('services.table.service')}</th>
                    <th className="text-left p-4 text-gray-300 font-medium">{t('services.table.type')}</th>
                    <th className="text-left p-4 text-gray-300 font-medium">{t('services.table.tags')}</th>
                    <th className="text-right p-4 text-gray-300 font-medium">{t('services.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((service) => {
                    const serviceType = getServiceType(service.serviceTypeId)
                    const isSelected = selectedServices.includes(service.id)

                    return (
                      <tr
                        key={service.id}
                        className={`border-b border-gray-700 hover:bg-gray-750 cursor-pointer ${
                          isSelected ? "bg-blue-900/20" : ""
                        }`}
                        onClick={() => handleServiceClick(service.id)}
                      >
                        <td className="p-2 w-8"><Checkbox checked={isSelected} onCheckedChange={() => toggleServiceSelection(service.id)} onClick={(e) => e.stopPropagation()} /></td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                              <span className="text-white text-sm font-bold">{serviceType?.name.charAt(0) || "S"}</span>
                            </div>
                            <span className="text-white font-medium">{service.label}</span>
                          </div>
                        </td>
                        <td className="p-4 text-gray-400">{serviceType?.name}</td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {service.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="secondary" className="bg-gray-700 text-gray-300">
                                {tag}
                              </Badge>
                            ))}
                            {service.tags.length > 3 && (
                              <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                                +{service.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white" onClick={(e) => { e.stopPropagation(); handleEditService(service); }}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); handleDeleteService(service.id); }}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {filteredServices.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12">
            <div className="text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-2">{t('services.not_found')}</p>
              <p className="text-sm">{t('services.try_changing_filters')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateServiceModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        serviceToEdit={serviceToEdit}
      />
      <BulkLinkServicesModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        serviceIdsToLink={selectedServices}
        onLink={() => {
            setSelectedServices([]);
            setIsLinkModalOpen(false);
        }}
      />
    </div>
  )
}
