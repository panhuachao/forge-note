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
  | 'share'
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
  | 'arrow-path'
  | 'arrows-right-left'
  | 'check'
  | 'viewfinder-circle'
  | 'queue-list'
  | 'arrow-left'
  | 'arrow-right'
  | 'adjustments'
  | 'inbox'
  | 'shield-check'
  | 'list-bullet'
  | 'bars-3-center-left'
  | 'calendar'
  | 'bell'
  | 'bookmark'
  | 'book-open'
  | 'academic-cap'
  | 'light-bulb'
  | 'folder-open'
  | 'folder-tree'
  | 'cards'
  | 'chat-bubble'
  | 'bolt'
  | 'microphone'
  | 'arrow-up'
  | 'check-circle'
  | 'copy'
  | 'eye'
  | 'puzzle';

const outlineMap: Record<string, any> = {
  folder: HeroiconsOutline.FolderIcon,
  share: HeroiconsOutline.ShareIcon,
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
  'folder-tree': HeroiconsOutline.FolderIcon,
  cards: HeroiconsOutline.Squares2X2Icon,
  'magnifying-glass': HeroiconsOutline.MagnifyingGlassIcon,
  hashtag: HeroiconsOutline.HashtagIcon,
  'queue-list': HeroiconsOutline.QueueListIcon,
  'arrow-left': HeroiconsOutline.ArrowLeftIcon,
  'arrow-right': HeroiconsOutline.ArrowRightIcon,
  adjustments: HeroiconsOutline.AdjustmentsHorizontalIcon,
  inbox: HeroiconsOutline.InboxIcon,
  'shield-check': HeroiconsOutline.ShieldCheckIcon,
  'list-bullet': HeroiconsOutline.ListBulletIcon,
  'bars-3-center-left': HeroiconsOutline.Bars3CenterLeftIcon,
  calendar: HeroiconsOutline.CalendarDaysIcon,
  bell: HeroiconsOutline.BellIcon,
  bookmark: HeroiconsOutline.BookmarkIcon,
  'book-open': HeroiconsOutline.BookOpenIcon,
  'academic-cap': HeroiconsOutline.AcademicCapIcon,
  'light-bulb': HeroiconsOutline.LightBulbIcon,
  'chat-bubble': HeroiconsOutline.ChatBubbleLeftRightIcon,
  bolt: HeroiconsOutline.BoltIcon,
  microphone: HeroiconsOutline.MicrophoneIcon,
  'arrow-up': HeroiconsOutline.ArrowUpIcon,
  'check-circle': HeroiconsOutline.CheckCircleIcon,
  focus: HeroiconsOutline.ArrowsPointingInIcon,
  'arrows-pointing-out': HeroiconsOutline.ArrowsPointingOutIcon,
  'view-columns': HeroiconsOutline.EyeIcon,
  'document-text': HeroiconsOutline.DocumentTextIcon,
  'copy': HeroiconsOutline.DocumentDuplicateIcon,
  'eye': HeroiconsOutline.EyeIcon,
  'puzzle': HeroiconsOutline.PuzzlePieceIcon,
  'arrow-path': HeroiconsOutline.ArrowPathIcon,
  'arrows-right-left': HeroiconsOutline.ArrowsRightLeftIcon,
  'check': HeroiconsOutline.CheckIcon,
  'viewfinder-circle': HeroiconsOutline.ViewfinderCircleIcon
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
