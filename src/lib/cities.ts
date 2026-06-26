import { City } from '@/types'

export const CIUDADES_ASIA: City[] = [
  { slug: 'seoul',     nombre: 'Seúl',      lat: 37.46, lon: 126.44, estacion: 'Incheon Intl' },
  { slug: 'beijing',   nombre: 'Beijing',   lat: 40.08, lon: 116.58, estacion: 'Capital Intl' },
  { slug: 'shanghai',  nombre: 'Shanghái',  lat: 31.14, lon: 121.80, estacion: 'Pudong Intl' },
  { slug: 'hong-kong', nombre: 'Hong Kong', lat: 22.30, lon: 114.17, estacion: 'Hong Kong Observatory' },
  { slug: 'tokyo',     nombre: 'Tokio',     lat: 35.55, lon: 139.78, estacion: 'Haneda' },
  { slug: 'shenzhen',  nombre: 'Shenzhen',  lat: 22.64, lon: 113.80, estacion: "Bao'an Intl" },
  { slug: 'wuhan',     nombre: 'Wuhan',     lat: 30.78, lon: 114.21, estacion: 'Tianhe Intl' },
  { slug: 'chongqing', nombre: 'Chongqing', lat: 29.72, lon: 106.64, estacion: 'Jiangbei Intl' },
  { slug: 'chengdu',   nombre: 'Chengdu',   lat: 30.58, lon: 103.96, estacion: 'Shuangliu Intl' },
]

export const MODELOS_CLIMATICOS = [
  'best_match',
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'jma_seamless',
  'meteofrance_seamless',
  'ecmwf_ens',
]

export function getEstacion(mes: number): string {
  if (mes === 12 || mes === 1 || mes === 2) return 'Invierno'
  if (mes >= 3 && mes <= 5) return 'Primavera'
  if (mes >= 6 && mes <= 8) return 'Verano'
  return 'Otoño'
}
