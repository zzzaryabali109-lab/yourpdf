'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import {
  JpgToPdfImageIcon,
  WordToPdfImageIcon,
  PowerpointToPdfIcon,
  ExcelToPdfIcon,
  HtmlToPdfIcon,
  PdfToJpgIcon,
  PdfToWordIcon,
  PdfToPowerpointIcon,
  PdfToExcelIcon,
  PdfToPdfAIcon,
  MergePdfImageIcon,
  SplitPdfImageIcon,
  OcrPdfImageIcon,
  UnlockPdfIcon,
  ProtectPdfIcon,
  ComparePdfIcon,
  CompressPdfImageIcon,
} from '@/components/ui/convert-icons';

const convertToPdfItems = [
  {
    title: 'JPG to PDF',
    href: '/jpg-to-pdf',
    icon: <JpgToPdfImageIcon className="size-5 shrink-0 object-contain" />,
  },
  {
    title: 'WORD to PDF',
    href: '/word-to-pdf',
    icon: <WordToPdfImageIcon />,
  },
  {
    title: 'POWERPOINT to PDF',
    href: '/powerpoint-to-pdf',
    icon: <PowerpointToPdfIcon />,
  },
  {
    title: 'EXCEL to PDF',
    href: '/excel-to-pdf',
    icon: <ExcelToPdfIcon />,
  },
  {
    title: 'HTML to PDF',
    href: '/html-to-pdf',
    icon: <HtmlToPdfIcon />,
  },
];

const convertFromPdfItems = [
  {
    title: 'PDF to JPG',
    href: '/pdf-to-jpg',
    icon: <PdfToJpgIcon />,
  },
  {
    title: 'PDF to WORD',
    href: '/pdf-to-word',
    icon: <PdfToWordIcon />,
  },
  {
    title: 'PDF to POWERPOINT',
    href: '/pdf-to-powerpoint',
    icon: <PdfToPowerpointIcon />,
  },
  {
    title: 'PDF to EXCEL',
    href: '/pdf-to-excel',
    icon: <PdfToExcelIcon />,
  },
  {
    title: 'PDF to PDF/A',
    href: '#',
    icon: <PdfToPdfAIcon />,
  },
];

function ListItem({
  title,
  children,
  href,
  icon,
  ...props
}: React.ComponentPropsWithoutRef<'li'> & { href: string; icon?: React.ReactNode }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link href={href} className="flex flex-col gap-1 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors group">
          <div className="text-sm leading-none font-medium flex items-center gap-2">
            {icon}
            <span>{title}</span>
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">{children}</p>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}

export function NavigationMenuDemo() {
  return (
    <NavigationMenu viewport={false}>
      <NavigationMenuList>
        {/* Home Dropdown with unchanged UI structure, featuring Compress PDF */}
        <NavigationMenuItem>
          <NavigationMenuTrigger>Home</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-2 w-[min(calc(100vw-2rem),500px)] md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr] p-4">
              <li className="row-span-3">
                <NavigationMenuLink asChild>
                  <Link
                    className="from-muted/50 to-muted flex h-full w-full flex-col justify-end rounded-md bg-linear-to-b p-4 no-underline outline-hidden select-none focus:shadow-md"
                    href="/compress-pdf"
                    prefetch={true}
                  >
                    <CompressPdfImageIcon className="h-24 w-full rounded-md mb-2 object-contain" />
                    <div className="mt-1 mb-1 text-base font-medium">Compress PDF</div>
                    <p className="text-muted-foreground text-xs leading-tight">
                      Reduce PDF file size while maintaining the highest document quality and clarity.
                    </p>
                  </Link>
                </NavigationMenuLink>
              </li>
              <ListItem
                href="/merge-pdf"
                title="Merge PDF"
                icon={<MergePdfImageIcon className="size-5 shrink-0 object-contain" />}
              >
                Combine multiple PDF files into one unified document with ease.
              </ListItem>
              <ListItem
                href="/split-pdf"
                title="Split PDF"
                icon={<SplitPdfImageIcon className="size-5 shrink-0 object-contain" />}
              >
                Separate one page or a whole set for easy conversion into independent PDF files.
              </ListItem>
              <ListItem
                href="/ocr-pdf"
                title="OCR PDF"
                icon={<OcrPdfImageIcon className="size-5 shrink-0 object-contain" />}
              >
                Convert scanned PDFs into searchable and selectable text documents.
              </ListItem>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>

        {/* Convert to Dropdown with centered arrow under trigger, spacious horizontal layout, and horizontal icon+name rows */}
        <NavigationMenuItem>
          <NavigationMenuTrigger>Convert to</NavigationMenuTrigger>
          <NavigationMenuContent className="md:left-1/2 md:-translate-x-1/2">
            <div className="relative grid w-[min(calc(100vw-2rem),530px)] grid-cols-2 gap-4 sm:gap-10 px-4 sm:px-6 py-4.5 bg-popover rounded-2xl shadow-[0_15px_45px_rgba(0,0,0,0.12)]">
              {/* Pointer notch aligned directly under Convert to */}
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 size-2.5 rotate-45 bg-popover" />

              {/* Column 1: CONVERT TO PDF */}
              <div className="flex flex-col">
                <h4 className="text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase mb-2.5 px-1.5">
                  CONVERT TO PDF
                </h4>
                <ul className="flex flex-col gap-0.5">
                  {convertToPdfItems.map((item) => (
                    <li key={item.title}>
                      <NavigationMenuLink asChild>
                        <Link
                          href={item.href}
                          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}
                          className="flex flex-row items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent/60 transition-colors group cursor-pointer"
                        >
                          {item.icon}
                          <span className="text-[13px] font-bold tracking-tight text-foreground/90 group-hover:text-primary transition-colors whitespace-nowrap">
                            {item.title}
                          </span>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Column 2: CONVERT FROM PDF */}
              <div className="flex flex-col">
                <h4 className="text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase mb-2.5 px-1.5">
                  CONVERT FROM PDF
                </h4>
                <ul className="flex flex-col gap-0.5">
                  {convertFromPdfItems.map((item) => (
                    <li key={item.title}>
                      <NavigationMenuLink asChild>
                        <Link
                          href={item.href}
                          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}
                          className="flex flex-row items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent/60 transition-colors group cursor-pointer"
                        >
                          {item.icon}
                          <span className="text-[13px] font-bold tracking-tight text-foreground/90 group-hover:text-primary transition-colors whitespace-nowrap">
                            {item.title}
                          </span>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger>PDF Security</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-[min(calc(100vw-2rem),320px)] gap-1 p-3">
              <ListItem
                href="/unlock-pdf"
                title="Unlock PDF"
                icon={<UnlockPdfIcon className="size-4 shrink-0" />}
              >
                Remove password and security restrictions from your PDF.
              </ListItem>
              <ListItem
                href="/protect-pdf"
                title="Protect PDF"
                icon={<ProtectPdfIcon className="size-4 shrink-0" />}
              >
                Encrypt your PDF with a strong password to protect data.
              </ListItem>
              <ListItem
                href="/compare-pdf"
                title="Compare PDF"
                icon={<ComparePdfIcon className="size-4 shrink-0" />}
              >
                Compare two PDF files side by side and highlight differences.
              </ListItem>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href="/file-share">File share</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

export default NavigationMenuDemo;
