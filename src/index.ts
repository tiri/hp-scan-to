#!/usr/bin/env node
// noinspection XmlDeprecatedElement,HtmlDeprecatedTag

"use strict";

import os from "os";
import { Command, Option, OptionValues, program } from "commander";
import Bonjour from "bonjour";
import config from "config";
import HPApi from "./HPApi";
import PathHelper from "./PathHelper";
import { delay } from "./delay";
import { readDeviceCapabilities } from "./readDeviceCapabilities";
import {
  clearRegistrations,
  RegistrationConfig,
  waitScanEvent,
} from "./listening";
import {
  AdfAutoScanConfig,
  DirectoryConfig,
  saveScan,
  ScanConfig,
  scanFromAdf,
  waitAdfLoaded,
} from "./scanProcessing";

let iteration = 0;

async function listenCmd(
  registrationConfig: RegistrationConfig,
  scanConfig: ScanConfig,
  deviceUpPollingInterval: number,
) {
  // first make sure the device is reachable
  await HPApi.waitDeviceUp(deviceUpPollingInterval);
  let deviceUp = true;

  const folder = await PathHelper.getOutputFolder(
    scanConfig.directoryConfig.directory,
  );
  console.log(`Target folder: ${folder}`);

  const tempFolder = await PathHelper.getOutputFolder(
    scanConfig.directoryConfig.tempDirectory,
  );
  console.log(`Temp folder: ${tempFolder}`);

  const deviceCapabilities = await readDeviceCapabilities();

  let scanCount = 0;
  let keepActive = true;
  let errorCount = 0;
  while (keepActive) {
    console.log(`Running iteration: ${iteration} - errorCount: ${errorCount}`);
    try {
      const event = await waitScanEvent(deviceCapabilities, registrationConfig);
      scanCount = await PathHelper.getNextScanNumber(
        folder,
        scanCount,
        scanConfig.directoryConfig.filePattern,
      );
      console.log(`Scan event captured, saving scan #${scanCount}`);
      await saveScan(
        event,
        folder,
        tempFolder,
        scanCount,
        deviceCapabilities,
        scanConfig,
      );
    } catch (e) {
      console.log(e);
      if (await HPApi.isAlive()) {
        errorCount++;
      } else {
        deviceUp = false;
      }
    }

    if (errorCount === 50) {
      keepActive = false;
    }

    if (!deviceUp) {
      await HPApi.waitDeviceUp(deviceUpPollingInterval);
    } else {
      await delay(1000);
    }
  }
}

async function adfAutoscanCmd(
  adfAutoScanConfig: AdfAutoScanConfig,
  deviceUpPollingInterval: number,
) {
  // first make sure the device is reachable
  await HPApi.waitDeviceUp(deviceUpPollingInterval);
  let deviceUp = true;

  const folder = await PathHelper.getOutputFolder(
    adfAutoScanConfig.directoryConfig.directory,
  );
  console.log(`Target folder: ${folder}`);

  const tempFolder = await PathHelper.getOutputFolder(
    adfAutoScanConfig.directoryConfig.tempDirectory,
  );
  console.log(`Temp folder: ${tempFolder}`);

  const deviceCapabilities = await readDeviceCapabilities();

  let scanCount = 0;
  let keepActive = true;
  let errorCount = 0;
  while (keepActive) {
    console.log(`Running iteration: ${iteration} - errorCount: ${errorCount}`);
    try {
      await waitAdfLoaded(
        adfAutoScanConfig.pollingInterval,
        adfAutoScanConfig.startScanDelay,
      );

      scanCount++;

      console.log(`Scan event captured, saving scan #${scanCount}`);

      await scanFromAdf(
        scanCount,
        folder,
        tempFolder,
        adfAutoScanConfig,
        deviceCapabilities,
        new Date(),
      );
    } catch (e) {
      console.log(e);
      if (await HPApi.isAlive()) {
        errorCount++;
      } else {
        deviceUp = false;
      }
    }

    if (errorCount === 50) {
      keepActive = false;
    }

    if (!deviceUp) {
      await HPApi.waitDeviceUp(deviceUpPollingInterval);
    } else {
      await delay(1000);
    }
  }
}

async function clearRegistrationsCmd(cmd: Command) {
  const parentOption = cmd.parent!.opts();

  const ip = await getDeviceIp(parentOption);
  HPApi.setDeviceIP(ip);

  const isDebug = getIsDebug(parentOption);
  HPApi.setDebug(isDebug);
  await clearRegistrations();
}

function findOfficejetIp(deviceNamePrefix: string): Promise<string> {
  return new Promise((resolve) => {
    const bonjour = Bonjour();
    console.log("Searching device...");
    let browser = bonjour.find(
      {
        type: "http",
      },
      (service) => {
        console.log(".");
        if (
          service.name.startsWith(deviceNamePrefix) &&
          service.port === 80 &&
          service.type === "http" &&
          service.addresses != null
        ) {
          browser.stop();
          bonjour.destroy();
          console.log(`Found: ${service.name}`);
          resolve(service.addresses[0]);
        }
      },
    );
    browser.start();
  });
}

function getConfig<T>(name: string): T | undefined {
  return config.has(name) ? config.get<T>(name) : undefined;
}

function setupScanParameters(command: Command): Command {
  command.addOption(
    new Option(
      "-d, --directory <dir>",
      "Directory where scans are saved (default: /tmp/scan-to-pc<random>)",
    ).env("DIR")
  );
  command.addOption(
    new Option(
      "-t, --temp-directory <dir>",
      "Temp directory used for processing (default: /tmp/scan-to-pc<random>)",
    ).env("TEMP_DIR")
  );
  command.addOption(
    new Option(
      "-p, --pattern <pattern>",
      'Pattern for filename (i.e. "scan"_dd.mm.yyyy_hh:MM:ss, without this its scanPage<number>)',
    ).env("PATTERN")
  );
  command.addOption(
    new Option(
      "-r, --resolution <dpi>",
      "Resolution in DPI of the scans (default: 200)",
    ).env("RESOLUTION")
  );
  command.addOption(
    new Option(
      "-w, --width <width>",
      "With in pixel of the scans (default: 2481)",
    ).env("WIDTH")
  );
  command.addOption(
    new Option(
      "-h, --height <height>",
      "Height in pixel of the scans (default: 3507)",
    ).env("HEIGHT")
  );
  return command;
}

function setupParameterOpts(command: Command): Command {
  command.addOption(
    new Option(
      "-ip, --address <ip>",
      "IP address of the device (this overrides -p)",
    )
    .env("IP")
  );
  command.addOption(
    new Option(
      "--device-up-polling-interval <deviceUpPollingInterval>",
      "Device up polling interval in milliseconds",
    )
    .argParser(parseFloat)
    .env("DEVICE_UP_POLLING_INTERVAL")
  );
  command.addOption(
    new Option(
      "-n, --name <name>",
      "Name of the device for service discovery",
    )
    .env("NAME")
  ); // i.e. 'Deskjet 3520 series'

  command.addOption(
    new Option("-D, --debug", "Enable debug")
    .env("DEBUG")
  );
  return command;
}

async function getDeviceIp(options: OptionValues) {
  let ip = options.address || getConfig("ip");
  if (!ip) {
    const name = options.name || getConfig("name");
    ip = await findOfficejetIp(name || "HP Smart Tank Plus 570 series");
  }
  console.log(`Using device ip: ${ip}`);
  return ip;
}

function getIsDebug(options: OptionValues) {
  const debug =
    options.debug != null ? true : getConfig<boolean>("debug") || false;

  if (debug) {
    console.log(`IsDebug: ${debug}`);
  }
  return debug;
}

function getScanConfiguration(parentOption: OptionValues) {
  const directoryConfig: DirectoryConfig = {
    directory: parentOption.directory || getConfig("directory"),
    tempDirectory: parentOption.tempDirectory || getConfig("tempDirectory"),
    filePattern: parentOption.pattern || getConfig("pattern"),
  };

  const configWidth = (
    parentOption.width ||
    getConfig("width") ||
    0
  ).toString();
  const width =
    configWidth.toLowerCase() === "max"
      ? Number.MAX_SAFE_INTEGER
      : parseInt(configWidth, 10);

  const configHeight = (
    parentOption.width ||
    getConfig("height") ||
    "0"
  ).toString();
  const height =
    configWidth.toLowerCase() === "max"
      ? Number.MAX_SAFE_INTEGER
      : parseInt(configHeight, 10);

  const scanConfig: ScanConfig = {
    resolution: parseInt(
      parentOption.resolution || getConfig("resolution") || "200",
      10,
    ),
    width: width,
    height: height,
    directoryConfig,
  };
  return scanConfig;
}

function getDeviceUpPollingInterval(parentOption: OptionValues) {
  return (
    parentOption.deviceUpPollingInterval ||
    getConfig("deviceUpPollingInterval") ||
    1000
  );
}

async function main() {
  setupParameterOpts(program);
  const cmdListen = program.createCommand("listen");
  setupScanParameters(cmdListen)
    .description("Listen the device for new scan job to save to this target")
    .addOption(
      new Option(
        "-l, --label <label>",
        "The label to display on the device (the default is the hostname)",
      ).env("LABEL")
    )
    .action(async (options, cmd) => {
      const parentOption = cmd.parent.opts();

      const ip = await getDeviceIp(parentOption);
      HPApi.setDeviceIP(ip);

      const isDebug = getIsDebug(parentOption);
      HPApi.setDebug(isDebug);

      const registrationConfig: RegistrationConfig = {
        label: options.label || getConfig("label") || os.hostname(),
      };

      const deviceUpPollingInterval = getDeviceUpPollingInterval(parentOption);

      const scanConfig = getScanConfiguration(options);

      await listenCmd(registrationConfig, scanConfig, deviceUpPollingInterval);
    });
  program.addCommand(cmdListen, { isDefault: true });

  const cmdAdfAutoscan = program.createCommand("adf-autoscan");
  setupScanParameters(cmdAdfAutoscan)
    .addOption(
      new Option("--duplex", "If specified, the scan will be in duplex"),
    )
    .addOption(
      new Option(
        "--pdf",
        "If specified, the scan result will be a pdf document, the default is multiple jpeg files",
      ),
    )
    .addOption(
      new Option(
        "--pollingInterval <pollingInterval>",
        "Time interval in millisecond between each lookup for content in the automatic document feeder",
      ),
    )
    .description(
      "Automatically trigger a new scan job to this target once paper is detected in the automatic document feeder (adf)",
    )
    .addOption(
      new Option(
        "--start-scan-delay <startScanDelay>",
        "Once document are detected to be in the adf, this specify the wait delay in millisecond before triggering the scan",
      ),
    )
    .description(
      "Automatically trigger a new scan job to this target once paper is detected in the automatic document feeder (adf)",
    )
    .action(async (options, cmd) => {
      const parentOption = cmd.parent.opts();

      const ip = await getDeviceIp(parentOption);
      HPApi.setDeviceIP(ip);

      const isDebug = getIsDebug(parentOption);
      HPApi.setDebug(isDebug);

      const deviceUpPollingInterval = getDeviceUpPollingInterval(parentOption);

      const scanConfig = getScanConfiguration(options);

      const adfScanConfig: AdfAutoScanConfig = {
        ...scanConfig,
        isDuplex: options.isDuplex || getConfig("autoscan_duplex") || false,
        generatePdf: options.pdf || getConfig("autoscan_pdf") || false,
        pollingInterval:
          options.pollingInterval ||
          getConfig("autoscan_pollingInterval") ||
          1000,
        startScanDelay:
          options.startScanDelay ||
          getConfig("autoscan_startScanDelay") ||
          5000,
      };

      await adfAutoscanCmd(adfScanConfig, deviceUpPollingInterval);
    });
  program.addCommand(cmdAdfAutoscan);

  const cmdClearRegistrations = program.createCommand("clear-registrations");
  cmdClearRegistrations
    .description("Clear the list or registered target on the device")
    .action(async (options, cmd) => {
      await clearRegistrationsCmd(cmd);
    });
  program.addCommand(cmdClearRegistrations);

  await program.parseAsync(process.argv);
}

main().catch((err) => console.log(err));
