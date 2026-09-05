import { lazy, type ComponentType, type FC } from 'react';

type ToolProps = { initialData?: unknown };
type ToolComponent = ComponentType<ToolProps>;
type ToolModule = Record<string, unknown>;
type ToolModuleLoader = () => Promise<ToolModule>;

interface ToolModuleGroup {
  components: readonly string[];
  load: ToolModuleLoader;
}

const TOOL_MODULE_GROUPS: readonly ToolModuleGroup[] = [
  {
    components: [
      'ImgToWebp',
      'ImgToAvif',
      'ImgToPng',
      'ImgToJpg',
      'SvgToPng',
      'SvgToWebp',
      'VideoConverter',
      'VideoToHls',
      'VideoToGif',
      'GifToVideo',
      'VideoToAudio',
      'AudioConverter',
      'PdfToImages',
      'ImagesToPdf',
      'JsonYaml',
      'JsonCsv',
      'UnixTimestamp',
      'OvenTemp',
    ],
    load: () => import('../../tools/Converters'),
  },
  {
    components: [
      'ImgCompress',
      'ImgResize',
      'ImgCrop',
      'BulkImgConvert',
      'ImgMetadataClean',
      'ColorExtract',
      'PaletteGen',
      'SvgOptimize',
    ],
    load: () => import('../../tools/Image'),
  },
  {
    components: ['VideoCompress', 'VideoTrim', 'FrameExtract', 'VideoThumbnails', 'VideoMetadata'],
    load: () => import('../../tools/Video'),
  },
  {
    components: ['AudioCompress', 'AudioTrim', 'Id3Edit', 'WaveformGen'],
    load: () => import('../../tools/Audio'),
  },
  {
    components: [
      'PdfMerge',
      'PdfSplit',
      'PdfCompress',
      'PdfExtractReorder',
      'PdfMetadata',
      'PdfPassword',
      'PdfWatermark',
    ],
    load: () => import('../../tools/PDF'),
  },
  {
    components: [
      'JsonFormat',
      'Base64',
      'UrlEncode',
      'JwtInspect',
      'HashGen',
      'UuidGen',
      'RegexTester',
      'DiffChecker',
      'MarkdownPreview',
      'CodeMinify',
      'XmlToJson',
      'JsonToXml',
      'MarkdownToHtml',
      'Base64Image',
      'HtmlMinifier',
      'CssMinifier',
      'JsMinifier',
      'SqlFormatter',
      'JsonPathTester',
      'HttpHeadersParser',
      'UserAgentParser',
      'CronGenerator',
      'EnvFileGenerator',
      'RegexReplace',
      'UrlParser',
      'PasswordStrength',
      'Checksum',
    ],
    load: () => import('../../tools/Developer'),
  },
  {
    components: [
      'QrGen',
      'TimeZoneConverter',
      'FileSizeConverter',
      'BandwidthCalc',
      'DataTransferCalc',
      'ScreenResCalc',
      'AspectRatioCalc',
      'TypingSpeed',
      'ClothingSize',
    ],
    load: () => import('../../tools/Utilities'),
  },
  {
    components: [
      'CalculatorTool',
      'ScientificCalculator',
      'BMICalculator',
      'AgeCalculator',
      'CurrencyConverter',
      'UnitConverter',
      'TipCalculator',
      'LoanCalculator',
      'PercentageCalculator',
      'DateDifference',
      'CircleCalc',
      'StatisticsCalc',
      'ProbabilityCalc',
    ],
    load: () => import('../../tools/CalculatorSuite'),
  },
  {
    components: [
      'PasswordGenerator',
      'UuidGenerator',
      'LoremIpsum',
      'RandomNumber',
      'DiceRoller',
      'RandomPicker',
      'NameGenerator',
      'SecureToken',
      'BinaryConverter',
      'MACGenerator',
      'IPv4Generator',
      'CreditCardGenerator',
      'ColorGenerator',
      'SerialNumber',
      'SaltGenerator',
      'HexGenerator',
      'BarCode',
      'OTPGenerator',
      'KeyPairGenerator',
      'LotteryGenerator',
    ],
    load: () => import('../../tools/Generators'),
  },
  {
    components: [
      'TextCase',
      'TextCounter',
      'MorseCode',
      'CaesarCipher',
      'TextEncrypt',
      'UrlSlug',
      'WhitespaceRemover',
      'LineCounter',
      'TextReverse',
      'LeetSpeak',
      'TextToAscii',
      'CharMap',
      'TextFormatter',
      'Base32Tool',
      'PhoneNumberFormat',
      'CreditCardFormat',
      'HtmlEscape',
    ],
    load: () => import('../../tools/TextTools'),
  },
  {
    components: [
      'ColorPicker',
      'PaletteGenerator',
      'ColorMixer',
      'GradientGenerator',
      'ContrastChecker',
      'MaterialColors',
      'TailwindColors',
      'GoldenRatioPalette',
      'HueShift',
      'DarkenLighten',
      'RgbToHslTool',
      'HslToRgbTool',
      'ColorTemperature',
      'TintShade',
      'ColorBlindSimulator',
      'HexToRgbTool',
      'RgbToHexTool',
    ],
    load: () => import('../../tools/ColorTools'),
  },
  {
    components: ['SubdomainDiscovery'],
    load: () => import('../../tools/SubdomainDiscovery'),
  },
];

function resolveToolComponent(module: ToolModule, componentName: string): ToolComponent {
  const direct = module[componentName];
  if (typeof direct === 'function') return direct as ToolComponent;

  for (const value of Object.values(module)) {
    if (!value || typeof value !== 'object') continue;
    const nested = (value as Record<string, unknown>)[componentName];
    if (typeof nested === 'function') return nested as ToolComponent;
  }

  if (typeof module.default === 'function') return module.default as ToolComponent;
  throw new Error(`Tool component ${componentName} is not exported by its registered module.`);
}

function createLazyTool(componentName: string, load: ToolModuleLoader): FC<ToolProps> {
  return lazy(async () => ({
    default: resolveToolComponent(await load(), componentName),
  }));
}

export const TOOL_COMPONENTS: Readonly<Record<string, FC<ToolProps>>> = Object.freeze(
  Object.fromEntries(
    TOOL_MODULE_GROUPS.flatMap(({ components, load }) =>
      components.map((componentName) => [componentName, createLazyTool(componentName, load)]),
    ),
  ),
);
