import core from './en/core'
import library from './en/library'
import player from './en/player'
import settings from './en/settings'
import system from './en/system'

/** Английский словарь: русская строка интерфейса → перевод. Разбит по разделам приложения */
export const EN: Record<string, string> = { ...core, ...library, ...player, ...settings, ...system }
