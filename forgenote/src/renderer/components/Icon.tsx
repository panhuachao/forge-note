// 统一图标组件 - 基于 Heroicons
// 用法：<Icon name="folder" className="w-4 h-4" />
import * as HeroiconsOutline from '@heroicons/react/24/outline';
import * as HeroiconsSolid from '@heroicons/react/24/solid';

export type IconName =
  | 'folder'
  | 'folder-plus'
  | 'document'
  | 'document-plus'
  | 'home'
  | 'pencil'
  | 'pencil-square'
  | 'globe'
  | 'clipboard'
  | 'clock'
  | 'cog'
  | 'search'
  | 'tag'
  | 'moon'
  | 'sun'
  | 'trash'
  | 'link'
  | 'archive'
  | 'sparkles'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-up'
  | 'bars'
  | 'plus'
  | 'x-mark'
  | 'x-circle'
  | 'ellipsis'
  | 'arrows-up-down'
  | 'chevron-up-down'
  | 'minus'
  | 'square-2-stack'
  | 'magnifying-glass'
  | 'hashtag'
  | 'queue-list'
  | 'arrow-left'
  | 'arrow-right'
  | 'adjustments'
  | 'inbox'
  | 'shield-check'
  | 'list-bullet'
  | 'calendar'
  | 'bell'
  | 'bookmark'
  | 'book-open'
  | 'light-bulb'
  | 'folder-open'
  | 'chat-bubble'
  | 'bolt'
  | 'microphone'
  | 'arrow-up'
  | 'check-circle';

const outlineMap: Record<string, any> = {
  folder: HeroiconsOutline.FolderIcon,
  'folder-open': HeroiconsOutline.FolderOpenIcon,
  'folder-plus': HeroiconsOutline.FolderPlusIcon,
  document: HeroiconsOutline.DocumentIcon,
  'document-plus': HeroiconsOutline.DocumentPlusIcon,
  home: HeroiconsOutline.HomeIcon,
  pencil: HeroiconsOutline.PencilIcon,
  'pencil-square': HeroiconsOutline.PencilSquareIcon,
  globe: HeroiconsOutline.GlobeAltIcon,
  clipboard: HeroiconsOutline.ClipboardDocumentListIcon,
  clock: HeroiconsOutline.ClockIcon,
  cog: HeroiconsOutline.Cog6ToothIcon,
  search: HeroiconsOutline.MagnifyingGlassIcon,
  tag: HeroiconsOutline.TagIcon,
  moon: HeroiconsOutline.MoonIcon,
  sun: HeroiconsOutline.SunIcon,
  trash: HeroiconsOutline.TrashIcon,
  link: HeroiconsOutline.LinkIcon,
  archive: HeroiconsOutline.ArchiveBoxIcon,
  sparkles: HeroiconsOutline.SparklesIcon,
  'chevron-right': HeroiconsOutline.ChevronRightIcon,
  'chevron-down': HeroiconsOutline.ChevronDownIcon,
  'chevron-left': HeroiconsOutline.ChevronLeftIcon,
  'chevron-up': HeroiconsOutline.ChevronUpIcon,
  bars: HeroiconsOutline.Bars3Icon,
  plus: HeroiconsOutline.PlusIcon,
  'x-mark': HeroiconsOutline.XMarkIcon,
  'x-circle': HeroiconsOutline.XCircleIcon,
  ellipsis: HeroiconsOutline.EllipsisHorizontalIcon,
  'arrows-up-down': HeroiconsOutline.ArrowsUpDownIcon,
  'chevron-up-down': HeroiconsOutline.ChevronUpDownIcon,
  minus: HeroiconsOutline.MinusIcon,
  'square-2-stack': HeroiconsOutline.Squares2X2Icon,
  'magnifying-glass': HeroiconsOutline.MagnifyingGlassIcon,
  hashtag: HeroiconsOutline.HashtagIcon,
  'queue-list': HeroiconsOutline.QueueListIcon,
  'arrow-left': HeroiconsOutline.ArrowLeftIcon,
  'arrow-right': HeroiconsOutline.ArrowRightIcon,
  adjustments: HeroiconsOutline.AdjustmentsHorizontalIcon,
  inbox: HeroiconsOutline.InboxIcon,
  'shield-check': HeroiconsOutline.ShieldCheckIcon,
  'list-bullet': HeroiconsOutline.Bars3BottomLeftIcon,
  calendar: HeroiconsOutline.CalendarDaysIcon,
  bell: HeroiconsOutline.BellIcon,
  bookmark: HeroiconsOutline.BookmarkIcon,
  'book-open': HeroiconsOutline.BookOpenIcon,
  'light-bulb': HeroiconsOutline.LightBulbIcon,
  'chat-bubble': HeroiconsOutline.ChatBubbleLeftRightIcon,
  bolt: HeroiconsOutline.BoltIcon,
  microphone: HeroiconsOutline.MicrophoneIcon,
  'arrow-up': HeroiconsOutline.ArrowUpIcon,
  'check-circle': HeroiconsOutline.CheckCircleIcon
};

const solidMap: Record<string, any> = {
  folder: HeroiconsSolid.FolderIcon,
  'folder-plus': HeroiconsSolid.FolderPlusIcon,
  document: HeroiconsSolid.DocumentIcon,
  home: HeroiconsSolid.HomeIcon,
  search: HeroiconsSolid.MagnifyingGlassIcon,
  'x-mark': HeroiconsSolid.XMarkIcon,
  plus: HeroiconsSolid.PlusIcon,
  'chevron-right': HeroiconsSolid.ChevronRightIcon,
  'chevron-down': HeroiconsSolid.ChevronDownIcon
};

interface IconProps {
  name: IconName;
  className?: string;
  solid?: boolean;
}

export function Icon({ name, className = 'w-4 h-4', solid = false }: IconProps) {
  const Comp = solid ? solidMap[name] : outlineMap[name];
  if (!Comp) return null;
  return <Comp className={className} aria-hidden="true" />;
}
