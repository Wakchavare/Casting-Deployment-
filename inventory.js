(function () {
  "use strict";

  const RBAC = window.ProductionRBAC;
  const receivingStorageKey = "production-management-metal-receiving-v1";
  const ledgerStorageKey = "production-management-inventory-ledger-v1";
  const receivingChangedEvent = "productionMetalReceivingChanged";
  const ledgerChangedEvent = "productionInventoryLedgerChanged";

  const metalTypes = ["Gold", "Platinum", "Silver"];
  const goldKtValues = ["24KT", "22KT", "18KT", "14KT", "10KT", "9KT"];
  const goldColorValues = ["Yellow", "White", "Rose"];
  const receivingPurityDefaults = {
    Gold: "24KT",
    Platinum: "950 Platinum",
    Silver: "925 Silver"
  };
  const receivingPurityValues = [...goldKtValues, receivingPurityDefaults.Platinum, receivingPurityDefaults.Silver];
  const transactionTypes = [
    "Metal Received",
    "Metal Consumed for Casting",
    "Finished Product Added",
    "Reusable Balance Added",
    "Scrap / Loss Recorded",
    "Manual Adjustment"
  ];

  function calculatePureMetalRequired(totalWeight, kt) {
    const weight = parseWeight(totalWeight);
    const ktValue = parseKt(kt);

    if (weight === null || ktValue === null) {
      return null;
    }

    return roundWeight(weight * (ktValue / 24));
  }

  function calculateReusableBalance(castingWeight, finishedProductWeight) {
    const castWeight = parseWeight(castingWeight);
    const finishedWeight = parseWeight(finishedProductWeight);

    if (castWeight === null || finishedWeight === null) {
      return null;
    }

    return roundWeight(castWeight - finishedWeight);
  }

  function calculateScrapLoss(totalIssuedWeight, castingWeight) {
    const issuedWeight = parseWeight(totalIssuedWeight);
    const castWeight = parseWeight(castingWeight);

    if (issuedWeight === null || castWeight === null) {
      return null;
    }

    return roundWeight(issuedWeight - castWeight);
  }

  function submitMetalReceiving(input = {}, options = {}) {
    const metalType = normalizeMetalType(input.metalType);
    let purity = String(input.purity || "").trim();
    let color = normalizeGoldColor(input.color);
    const weightReceived = parseWeight(input.weightReceived);
    const submittedAt = input.submittedAt || input.dateTime || new Date().toISOString();

    if (!metalType) {
      throw new Error("Metal Type is required.");
    }

    if (!purity) {
      throw new Error("Purity / KT is required.");
    }

    if (metalType === "Gold") {
      purity = normalizeGoldKt(purity);
      if (!purity) {
        throw new Error("Enter a valid Gold KT.");
      }

      if (parseKt(purity) === 24) {
        color = "";
      } else if (!color) {
        throw new Error("Color is required for non-24KT Gold.");
      }
    } else if (metalType === "Platinum") {
      purity = normalizeFixedReceivingPurity(purity, receivingPurityDefaults.Platinum);
      if (!purity) {
        throw new Error("Platinum must be received as 950 Platinum.");
      }
      color = "";
    } else if (metalType === "Silver") {
      purity = normalizeFixedReceivingPurity(purity, receivingPurityDefaults.Silver);
      if (!purity) {
        throw new Error("Silver must be received as 925 Silver.");
      }
      color = "";
    } else {
      color = "";
    }

    if (weightReceived === null || weightReceived <= 0) {
      throw new Error("Weight Received must be greater than 0 g.");
    }

    const receivingEntry = {
      id: createId("receiving"),
      color,
      metalKtColor: getReceivingMetalKtColor(metalType, purity, color),
      metalType,
      purity,
      weightReceived,
      supplier: String(input.supplier || "").trim(),
      referenceNumber: String(input.referenceNumber || "").trim(),
      submittedAt,
      notes: String(input.notes || "").trim(),
      locked: true,
      createdByUserId: options.user?.id || "",
      createdByUsername: options.user?.username || options.user?.name || ""
    };

    const state = readReceivingState();
    state.entries.unshift(receivingEntry);
    writeReceivingState(state);

    const ledgerEntry = createInventoryLedgerEntry(
      {
        transactionType: "Metal Received",
        color,
        metalKtColor: getReceivingMetalKtColor(metalType, purity, color),
        metalType,
        purity,
        category: getReceivingCategory(metalType, purity),
        inWeight: weightReceived,
        outWeight: 0,
        sourceModule: "Metal Receiving",
        sourceId: receivingEntry.id,
        notes: receivingEntry.notes || receivingEntry.referenceNumber,
        createdAt: submittedAt
      },
      options
    );

    recordAudit("Metal received", {
      user: options.user,
      module: "Metal Receiving",
      newValue: sanitizeReceivingEntry(receivingEntry),
      notes: receivingEntry.notes
    });
    recordAudit("Receiving entry submitted", {
      user: options.user,
      module: "Metal Receiving",
      newValue: sanitizeReceivingEntry(receivingEntry),
      notes: receivingEntry.referenceNumber
    });

    return {
      ledgerEntry,
      receivingEntry: sanitizeReceivingEntry(receivingEntry)
    };
  }

  function postOrderToInventory(order = {}, options = {}) {
    if (order.inventoryPosted) {
      recordAudit("Attempted duplicate inventory posting", {
        user: options.user,
        barcodeValue: order.barcodeValue || order.barcodeDisplay || "",
        isInHouseProduction: Boolean(order.isInHouseProduction),
        module: "Inventory",
        stage: "Order Completed",
        internalTreeNumber: order.orderCode,
        newValue: { orderId: order.id }
      });
      throw new Error("Inventory has already been posted for this order.");
    }

    if (hasInventoryPostingForOrder(order.id)) {
      recordAudit("Attempted duplicate inventory posting", {
        user: options.user,
        barcodeValue: order.barcodeValue || order.barcodeDisplay || "",
        isInHouseProduction: Boolean(order.isInHouseProduction),
        module: "Inventory",
        stage: "Order Completed",
        internalTreeNumber: order.orderCode,
        newValue: { orderId: order.id }
      });
      throw new Error("Inventory ledger already contains a final posting for this order.");
    }

    if (order.isDamaged || order.removedFromBoard || order.finalStatus === "Damaged") {
      throw new Error("Damaged trees cannot be posted as normal completed orders.");
    }

    const totalIssuedWeight = parseWeight(order.totalIssuedWeight);
    const castingWeight = parseWeight(order.castingWeight);
    const finishedProductWeight = parseWeight(order.finishedProductWeight || order.receivedOrderWeight);

    if (totalIssuedWeight === null) {
      throw new Error("Total Issued Weight is required before inventory posting.");
    }

    if (castingWeight === null) {
      throw new Error("Casting Weight is required before inventory posting.");
    }

    if (finishedProductWeight === null || finishedProductWeight <= 0) {
      throw new Error("Finished Product Weight is required before inventory posting.");
    }

    const reusableBalanceWeight = calculateReusableBalance(castingWeight, finishedProductWeight);
    const scrapLossWeight = calculateScrapLoss(totalIssuedWeight, castingWeight);

    if (reusableBalanceWeight === null || reusableBalanceWeight < 0) {
      throw new Error("Reusable Balance Weight cannot be negative.");
    }

    if (scrapLossWeight === null || scrapLossWeight < 0) {
      throw new Error("Scrap / Loss Weight cannot be negative.");
    }

    const metalInfo = getOrderMetalInfo(order);
    const pureConsumedWeight = getPureConsumedWeight(totalIssuedWeight, metalInfo);
    if (pureConsumedWeight === null || pureConsumedWeight <= 0) {
      throw new Error("A supported Metal KT / Type is required before inventory posting.");
    }

    const postedAt = options.postedAt || new Date().toISOString();
    const baseEntry = {
      relatedBarcodeValue: order.barcodeValue || order.barcodeDisplay || "",
      relatedInternalTreeNumber: order.orderCode || "",
      relatedOrderId: order.id || "",
      sourceModule: "Order Completed",
      sourceId: order.id || "",
      createdAt: postedAt,
      notes: options.notes || ""
    };

    const ledgerEntries = [];
    ledgerEntries.push(
      createInventoryLedgerEntry(
        {
          ...baseEntry,
          transactionType: "Metal Consumed for Casting",
          color: metalInfo.color,
          metalType: metalInfo.metalType,
          metalKtColor: metalInfo.metalKtColor,
          purity: metalInfo.metalType === "Gold" ? "24KT" : "Pure",
          category: getPureCategory(metalInfo.metalType),
          outWeight: pureConsumedWeight
        },
        options
      )
    );
    ledgerEntries.push(
      createInventoryLedgerEntry(
        {
          ...baseEntry,
          transactionType: "Finished Product Added",
          color: metalInfo.color,
          metalType: metalInfo.metalType,
          metalKtColor: metalInfo.metalKtColor,
          category: "finished",
          inWeight: finishedProductWeight
        },
        options
      )
    );

    ledgerEntries.push(
      createInventoryLedgerEntry(
        {
          ...baseEntry,
          transactionType: "Reusable Balance Added",
          color: metalInfo.color,
          metalType: metalInfo.metalType,
          metalKtColor: metalInfo.metalKtColor,
          category: "reusable",
          inWeight: reusableBalanceWeight
        },
        options
      )
    );
    ledgerEntries.push(
      createInventoryLedgerEntry(
        {
          ...baseEntry,
          transactionType: "Scrap / Loss Recorded",
          color: metalInfo.color,
          metalType: metalInfo.metalType,
          metalKtColor: metalInfo.metalKtColor,
          category: "scrapLoss",
          inWeight: scrapLossWeight
        },
        options
      )
    );

    recordAudit("Final inventory posted", {
      user: options.user,
      barcodeValue: order.barcodeValue || order.barcodeDisplay || "",
      isInHouseProduction: Boolean(order.isInHouseProduction),
      module: "Inventory",
      stage: "Order Completed",
      internalTreeNumber: order.orderCode,
      newValue: {
        finishedProductWeight,
        excessRecycledWeight: order.excessRecycledWeight ?? order.metalIssue?.excessRecycledWeight ?? "",
        ledgerEntryIds: ledgerEntries.map((entry) => entry.id),
        recycledMetalColor: order.recycledMetalColor ?? order.metalIssue?.recycledMetalColor ?? "",
        recycledMetalKt: order.recycledMetalKt ?? order.metalIssue?.recycledMetalKt ?? "",
        reusableBalanceWeight,
        scrapLossWeight
      }
    });
    recordAudit("Order locked after inventory posting", {
      user: options.user,
      barcodeValue: order.barcodeValue || order.barcodeDisplay || "",
      isInHouseProduction: Boolean(order.isInHouseProduction),
      module: "Casting Process",
      stage: "Order Completed",
      internalTreeNumber: order.orderCode,
      newValue: { inventoryPosted: true }
    });

    return {
      finishedProductWeight,
      ledgerEntries,
      metalInfo,
      pureConsumedWeight,
      reusableBalanceWeight,
      scrapLossWeight
    };
  }

  function createInventoryLedgerEntry(input = {}, options = {}) {
    const ledgerState = readLedgerState();
    const entry = normalizeLedgerEntry(input, options);
    const previousBalance = getBalanceForBucket(ledgerState.entries, entry.bucketKey);
    const balanceAfterTransaction = roundWeight(previousBalance + entry.inWeight - entry.outWeight);
    const ledgerEntry = {
      ...entry,
      balanceAfterTransaction
    };

    ledgerState.entries.unshift(ledgerEntry);
    writeLedgerState(ledgerState);

    recordAudit("Inventory ledger transaction created", {
      user: options.user,
      barcodeValue: ledgerEntry.relatedBarcodeValue,
      module: "Inventory",
      internalTreeNumber: ledgerEntry.relatedInternalTreeNumber,
      newValue: ledgerEntry,
      notes: ledgerEntry.transactionType
    });

    return ledgerEntry;
  }

  function getInventoryLedger() {
    return readLedgerState().entries.sort(
      (first, second) => (new Date(second.createdAt).getTime() || 0) - (new Date(first.createdAt).getTime() || 0)
    );
  }

  function getReceivingEntries() {
    return readReceivingState().entries.map(sanitizeReceivingEntry);
  }

  function getInventoryBalances() {
    const balances = new Map();

    getInventoryLedger().forEach((entry) => {
      const currentBalance = balances.get(entry.bucketKey) || {
        balance: 0,
        category: entry.category,
        color: entry.color || "",
        label: getBucketLabel(entry),
        metalKtColor: entry.metalKtColor || "",
        metalType: entry.metalType,
        purity: entry.purity || ""
      };

      currentBalance.balance = roundWeight(currentBalance.balance + entry.inWeight - entry.outWeight);
      balances.set(entry.bucketKey, currentBalance);
    });

    return Array.from(balances.values()).sort((first, second) => first.label.localeCompare(second.label));
  }

  function hasInventoryPostingForOrder(orderId) {
    if (!orderId) return false;

    return getInventoryLedger().some(
      (entry) =>
        entry.relatedOrderId === orderId &&
        entry.sourceModule === "Order Completed" &&
        [
          "Metal Consumed for Casting",
          "Finished Product Added",
          "Reusable Balance Added",
          "Scrap / Loss Recorded"
        ].includes(entry.transactionType)
    );
  }

  function normalizeLedgerEntry(input, options) {
    const category = String(input.category || getCategoryFromTransactionType(input.transactionType)).trim();
    const color = String(input.color || "").trim();
    const metalType = normalizeMetalType(input.metalType);
    const metalKtColor = String(input.metalKtColor || "").trim();
    const purity = String(input.purity || "").trim();
    const bucketKey = getBucketKey({
      category,
      metalKtColor,
      metalType,
      purity
    });

    return {
      id: input.id || createId("ledger"),
      bucketKey,
      category,
      createdAt: input.createdAt || new Date().toISOString(),
      createdByUserId: options.user?.id || "",
      createdByUsername: options.user?.username || options.user?.name || "",
      color,
      inWeight: parseWeight(input.inWeight) || 0,
      metalKtColor,
      metalType,
      notes: String(input.notes || "").trim(),
      outWeight: parseWeight(input.outWeight) || 0,
      purity,
      relatedBarcodeValue: String(input.relatedBarcodeValue || "").trim(),
      relatedInternalTreeNumber: String(input.relatedInternalTreeNumber || "").trim(),
      relatedOrderId: String(input.relatedOrderId || "").trim(),
      sourceId: String(input.sourceId || "").trim(),
      sourceModule: String(input.sourceModule || "").trim(),
      transactionType: String(input.transactionType || "Manual Adjustment").trim()
    };
  }

  function getOrderMetalInfo(order) {
    const metalKt = String(order.metalKt || "").trim();
    const color = String(order.color || order.castingColor || "").trim();
    const metalDisplay = String(order.metalDisplay || "").trim();
    const displayParts = metalDisplay.split(/\s+/);
    const ktFromDisplay = displayParts.find((part) => /KT$/i.test(part)) || "";
    const metal = metalKt || ktFromDisplay || displayParts[0] || "";
    const normalizedMetal = metal.toLowerCase();

    if (normalizedMetal === "silver") {
      return {
        color: "White",
        metalKtColor: "Silver White",
        metalType: "Silver",
        purity: "Pure"
      };
    }

    if (normalizedMetal === "plat" || normalizedMetal === "platinum") {
      return {
        color: "White",
        metalKtColor: "Platinum White",
        metalType: "Platinum",
        purity: "Pure"
      };
    }

    const kt = /KT$/i.test(metal) ? metal.toUpperCase() : ktFromDisplay.toUpperCase();
    const orderColor = color || displayParts[1] || "";
    return {
      color: orderColor,
      metalKtColor: [kt, orderColor].filter(Boolean).join(" "),
      metalType: "Gold",
      purity: kt
    };
  }

  function getPureConsumedWeight(totalIssuedWeight, metalInfo) {
    if (metalInfo.metalType === "Gold") {
      return calculatePureMetalRequired(totalIssuedWeight, metalInfo.purity);
    }

    return parseWeight(totalIssuedWeight);
  }

  function getCategoryFromTransactionType(transactionType) {
    if (transactionType === "Finished Product Added") return "finished";
    if (transactionType === "Reusable Balance Added") return "reusable";
    if (transactionType === "Scrap / Loss Recorded") return "scrapLoss";
    return "pure";
  }

  function getPureCategory(metalType) {
    return metalType === "Gold" ? "pureGold" : `pure${metalType}`;
  }

  function getReceivingCategory(metalType, purity) {
    if (metalType === "Gold" && parseKt(purity) !== 24) {
      return "goldStock";
    }

    return getPureCategory(metalType);
  }

  function getReceivingMetalKtColor(metalType, purity, color) {
    if (metalType === "Gold") {
      return parseKt(purity) === 24 ? "24KT Gold" : [purity, color, "Gold"].filter(Boolean).join(" ");
    }

    return purity || metalType;
  }

  function getBucketKey(entry) {
    const category = entry.category || "pure";
    const pureCategories = new Set(["pure", "pureGold", "purePlatinum", "pureSilver"]);
    const metalKtColor = pureCategories.has(category) ? "" : String(entry.metalKtColor || "").trim();
    const purity = pureCategories.has(category) ? getPureBucketPurity(entry) : String(entry.purity || "").trim();

    return [
      category,
      normalizeMetalType(entry.metalType),
      purity,
      metalKtColor
    ]
      .filter(Boolean)
      .join("|");
  }

  function getPureBucketPurity(entry) {
    const metalType = normalizeMetalType(entry.metalType);

    if (entry.category === "pureGold" || metalType === "Gold") {
      return "24KT";
    }

    if (entry.category === "purePlatinum" || metalType === "Platinum") {
      return entry.purity && entry.purity !== "Pure" ? entry.purity : receivingPurityDefaults.Platinum;
    }

    if (entry.category === "pureSilver" || metalType === "Silver") {
      return entry.purity && entry.purity !== "Pure" ? entry.purity : receivingPurityDefaults.Silver;
    }

    return String(entry.purity || "").trim();
  }

  function getBucketLabel(entry) {
    if (entry.category === "pureGold") return "Pure Gold / 24KT Gold";
    if (entry.category === "purePlatinum") return "Platinum";
    if (entry.category === "pureSilver") return "Silver";
    if (entry.category === "goldStock") return entry.metalKtColor || `${entry.purity} ${entry.color} Gold`;
    if (entry.category === "reusable") return `${entry.metalKtColor || entry.metalType} reusable balance`;
    if (entry.category === "finished") return `${entry.metalKtColor || entry.metalType} finished product stock`;
    if (entry.category === "scrapLoss") return `${entry.metalKtColor || entry.metalType} scrap / loss`;
    return entry.metalKtColor || entry.purity || entry.metalType || "Inventory";
  }

  function getBalanceForBucket(entries, bucketKey) {
    return entries
      .filter((entry) => entry.bucketKey === bucketKey)
      .reduce((balance, entry) => roundWeight(balance + entry.inWeight - entry.outWeight), 0);
  }

  function parseKt(value) {
    const matchedValue = String(value || "").match(/(\d+(?:\.\d+)?)\s*KT/i);
    if (!matchedValue) return null;

    const kt = Number.parseFloat(matchedValue[1]);
    return Number.isFinite(kt) ? kt : null;
  }

  function normalizeGoldKt(value) {
    const kt = parseKt(value);
    if (kt === null || kt <= 0 || kt > 24) return "";

    return `${formatKtNumber(kt)}KT`;
  }

  function normalizeFixedReceivingPurity(value, expectedPurity) {
    const normalizedValue = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const expectedValue = expectedPurity.toLowerCase();
    const expectedNumber = expectedPurity.match(/\d+/)?.[0] || "";
    const expectedMetal = expectedPurity.replace(expectedNumber, "").trim().toLowerCase();

    if (!normalizedValue || normalizedValue === "pure") {
      return "";
    }

    if (
      normalizedValue === expectedValue ||
      normalizedValue === expectedNumber ||
      normalizedValue === `${expectedNumber} ${expectedMetal}` ||
      normalizedValue === `${expectedMetal} ${expectedNumber}` ||
      normalizedValue === `${expectedMetal}${expectedNumber}` ||
      normalizedValue === `${expectedNumber}${expectedMetal}`
    ) {
      return expectedPurity;
    }

    return "";
  }

  function getReceivingDefaultPurity(metalType) {
    return receivingPurityDefaults[normalizeMetalType(metalType)] || receivingPurityDefaults.Gold;
  }

  function formatKtNumber(value) {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
  }

  function parseWeight(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }

    const parsedValue = Number.parseFloat(String(value).trim());
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  function roundWeight(value) {
    return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
  }

  function formatWeight(value) {
    const parsedValue = parseWeight(value);
    if (parsedValue === null) return "Not available";

    return `${roundWeight(parsedValue).toFixed(3).replace(/\.?0+$/, "")} g`;
  }

  function normalizeMetalType(value) {
    const normalizedValue = String(value || "").trim().toLowerCase();
    if (normalizedValue === "gold") return "Gold";
    if (normalizedValue === "platinum" || normalizedValue === "plat") return "Platinum";
    if (normalizedValue === "silver") return "Silver";
    return "";
  }

  function normalizeGoldColor(value) {
    const normalizedValue = String(value || "").trim().toLowerCase();
    if (normalizedValue === "pure") return "";

    const matchedColor = goldColorValues.find((color) => color.toLowerCase() === normalizedValue);
    return matchedColor || "";
  }

  function sanitizeReceivingEntry(entry) {
    return {
      color: entry.color || "",
      createdByUserId: entry.createdByUserId || "",
      createdByUsername: entry.createdByUsername || "",
      id: entry.id,
      locked: Boolean(entry.locked),
      metalKtColor: entry.metalKtColor || "",
      metalType: entry.metalType,
      notes: entry.notes || "",
      purity: entry.purity,
      referenceNumber: entry.referenceNumber || "",
      submittedAt: entry.submittedAt || "",
      supplier: entry.supplier || "",
      weightReceived: entry.weightReceived
    };
  }

  function readReceivingState() {
    const storedState = readJson(receivingStorageKey);
    return {
      entries:
        storedState && Array.isArray(storedState.entries)
          ? storedState.entries.map(sanitizeReceivingEntry)
          : []
    };
  }

  function writeReceivingState(state) {
    localStorage.setItem(receivingStorageKey, JSON.stringify({ entries: state.entries.map(sanitizeReceivingEntry) }));
    window.dispatchEvent(new CustomEvent(receivingChangedEvent, { detail: { entries: getReceivingEntries() } }));
  }

  function readLedgerState() {
    const storedState = readJson(ledgerStorageKey);
    return {
      entries:
        storedState && Array.isArray(storedState.entries)
          ? storedState.entries.map((entry) => ({
              ...normalizeLedgerEntry(entry, {
                user: {
                  id: entry.createdByUserId,
                  username: entry.createdByUsername
                }
              }),
              balanceAfterTransaction: roundWeight(Number.parseFloat(entry.balanceAfterTransaction) || 0)
            }))
          : []
    };
  }

  function writeLedgerState(state) {
    localStorage.setItem(ledgerStorageKey, JSON.stringify({ entries: state.entries }));
    window.dispatchEvent(new CustomEvent(ledgerChangedEvent, { detail: { entries: getInventoryLedger() } }));
  }

  function recordAudit(action, details = {}) {
    if (!RBAC?.recordAuditLog) return;

    RBAC.recordAuditLog({
      action,
      user: details.user || RBAC.currentUser,
      ...details
    });
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  window.ProductionInventory = {
    calculatePureMetalRequired,
    calculateReusableBalance,
    calculateScrapLoss,
    createInventoryLedgerEntry,
    formatWeight,
    getInventoryBalances,
    getInventoryLedger,
    getOrderMetalInfo,
    getReceivingEntries,
    goldColorValues,
    goldKtValues,
    hasInventoryPostingForOrder,
    ledgerChangedEvent,
    metalTypes,
    parseWeight,
    postOrderToInventory,
    receivingChangedEvent,
    receivingPurityDefaults,
    receivingPurityValues,
    getReceivingDefaultPurity,
    submitMetalReceiving,
    transactionTypes
  };
})();
