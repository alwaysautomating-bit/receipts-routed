import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  RefreshCcw, 
  Search,
  Plus,
  X,
  ChevronRight,
  Database,
  AlertTriangle,
  Info,
  Edit3,
  Camera,
  Mic,
  File,
  Image as ImageIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type CaptureType = "Invoice" | "Receipt" | "Issue" | "Unknown";
type ExceptionType = "Price Mismatch" | "Duplicate" | "Missing Information" | "Unclear Document" | "Needs Review";
type Status = "Pending" | "Valid" | "Invalid" | "Processing";

interface CaptureRecord {
  title: string;
  vendor: string;
  amount: string;
  invoiceDate: string;
  captureType: CaptureType;
  status: Status;
  routeTo: string;
  userNotes: string;
  exceptionType: ExceptionType | null;
  processingNotes: string;
  source: string;
  rawInput: string;
}

export default function App() {
  const [step, setStep] = useState<"capture" | "processing" | "review" | "success">("capture");
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Convert file to base64
  useEffect(() => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setFileBase64(base64String.split(",")[1]);
      };
      reader.readAsDataURL(file);
    } else {
      setFileBase64(null);
    }
  }, [file]);

  const validateRecord = (data: any): { status: Status; exceptionType: ExceptionType | null } => {
    const hasVendor = !!data.vendor && data.vendor.trim().length > 0;
    const amountNum = parseFloat(data.amount);
    const hasValidAmount = !isNaN(amountNum) && amountNum > 0;
    const hasValidDate = !!data.invoiceDate && !isNaN(Date.parse(data.invoiceDate));

    if (hasVendor && hasValidAmount && hasValidDate) {
      return { status: "Valid", exceptionType: null };
    }

    return { 
      status: "Invalid", 
      exceptionType: data.exceptionType || "Missing Information" 
    };
  };

  const extractData = async (input: string, notes: string, base64?: string | null) => {
    const prompt = `
      Extract invoice/receipt details from the following input.
      Raw Input: ${input}
      User Notes: ${notes}
      
      Rules:
      - Vendor: The name of the company or person issuing the invoice.
      - Amount: The total amount due as a numeric string (e.g., "125.50").
      - Invoice Date: The date of the invoice in YYYY-MM-DD format.
      - Capture Type: One of "Invoice", "Receipt", "Issue", "Unknown".
        - Invoice: bill requesting payment.
        - Receipt: proof of payment.
        - Issue: user indicates something is wrong or needs review.
        - Unknown: cannot determine.
      - Exception Type: One of "Price Mismatch", "Duplicate", "Missing Information", "Unclear Document", "Needs Review".
      - Processing Notes: A brief summary of what was found or what is missing.
      
      Interpret User Notes into Exception Type where appropriate.
    `;

    const parts: any[] = [{ text: prompt }];
    if (base64) {
      parts.push({
        inlineData: {
          mimeType: file?.type || "image/jpeg",
          data: base64
        }
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vendor: { type: Type.STRING },
            amount: { type: Type.STRING },
            invoiceDate: { type: Type.STRING },
            captureType: { type: Type.STRING },
            exceptionType: { type: Type.STRING },
            processingNotes: { type: Type.STRING }
          },
          required: ["vendor", "amount", "invoiceDate", "captureType", "processingNotes"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  };

  const handleCapture = async () => {
    if (!rawInput && !file) {
      toast.error("Please provide an invoice file or text input");
      return;
    }

    setStep("processing");
    
    try {
      // 1. Save raw input to backend
      await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput, userNotes, fileName: file?.name })
      });

      // 2. Extract data using Gemini
      const data = await extractData(rawInput, userNotes, fileBase64);
      
      // 3. Validate
      const { status, exceptionType } = validateRecord(data);

      const newRecord: CaptureRecord = {
        title: data.vendor && data.invoiceDate ? `${data.vendor} - ${data.invoiceDate}` : `Unprocessed Invoice - ${new Date().getTime()}`,
        vendor: data.vendor || "",
        amount: data.amount || "",
        invoiceDate: data.invoiceDate || "",
        captureType: (data.captureType as CaptureType) || "Unknown",
        status,
        routeTo: "Google Sheets Only",
        userNotes,
        exceptionType: (exceptionType as ExceptionType) || null,
        processingNotes: data.processingNotes || "Automated extraction complete.",
        source: file ? "Upload" : "Paste",
        rawInput
      };

      setRecord(newRecord);
      setStep("review");
      
      if (status === "Invalid") {
        toast.error("Validation failed. Please correct the details.");
      } else {
        toast.success("Data extracted successfully.");
      }
    } catch (error) {
      console.error("Extraction error:", error);
      toast.error("Extraction failed. Please try again.");
      setStep("capture");
    }
  };

  const handleCorrection = async () => {
    if (!record) return;
    
    const { status, exceptionType } = validateRecord(record);
    
    if (status === "Invalid") {
      toast.error("Still missing required information.");
      setRecord({ ...record, status, exceptionType });
      return;
    }

    setRecord({ ...record, status, exceptionType: null });
    toast.success("Validation passed.");
  };

  const handleFinalSubmit = async () => {
    if (!record) return;
    
    setStep("processing");
    
    try {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
      
      if (response.ok) {
        setStep("success");
        toast.success("Record routed successfully");
      }
    } catch (error) {
      toast.error("Failed to route record");
      setStep("review");
    }
  };

  const reset = () => {
    setStep("capture");
    setRecord(null);
    setRawInput("");
    setUserNotes("");
    setFile(null);
    setFileBase64(null);
  };

  return (
    <div className="min-h-screen selection:bg-red-500/10">
      <header className="border-b border-black/5 bg-white/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div 
              className="w-8 h-8 bg-[#1A1A1A] rounded-md flex items-center justify-center text-white font-bold shadow-sm relative overflow-hidden"
              whileHover={{ scale: 1.05 }}
            >
              S
              <div className="absolute top-1 right-1 w-1 h-1 bg-red-500 rounded-full" />
            </motion.div>
            <h1 className="text-lg font-montserrat font-semibold tracking-tight text-[#1A1A1A]">SYNCd <span className="text-black/40">Lite</span></h1>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8 relative">
        <AnimatePresence mode="wait">
          {step === "capture" && (
            <motion.div
              key="capture"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
                <div className="relative">
                  <Textarea 
                    placeholder="Paste receipt text or describe the order here..."
                    className="min-h-[160px] text-base font-sans bg-white/60 border-black/10 text-[#1A1A1A] focus-visible:ring-black/20 focus-visible:border-black/20 rounded-xl p-4 pb-16 shadow-sm resize-none"
                    value={rawInput}
                    onChange={(e) => setRawInput(e.target.value)}
                  />
                  
                  <div className="absolute left-3 bottom-3 flex items-center gap-2">
                    <Button 
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 rounded-full bg-white border border-black/10 shadow-sm text-[#1A1A1A] hover:bg-black/5 shrink-0"
                      onClick={() => setShowMenu(true)}
                    >
                      <Plus className="w-5 h-5" />
                    </Button>

                    <AnimatePresence>
                      {file && (
                        <motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="p-1 px-2 bg-white border border-black/10 rounded-lg flex items-center gap-2 shadow-sm max-w-[200px]"
                        >
                          <ImageIcon className="w-4 h-4 text-green-600 shrink-0" />
                          <span className="text-xs font-medium truncate text-[#1A1A1A]">{file.name}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 rounded-md hover:bg-red-500/10 hover:text-red-600 ml-1" onClick={() => setFile(null)}>
                            <X className="w-3 h-3 text-current" />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <AnimatePresence>
                  {showMenu && (
                    <>
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 z-[60]"
                        onClick={() => setShowMenu(false)}
                      />
                      <motion.div 
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-[70]"
                      >
                        <div className="bg-white rounded-2xl shadow-xl p-2 flex flex-col gap-1">
                          <Button 
                            variant="ghost" 
                            className="h-14 justify-start font-sans text-base rounded-xl hover:bg-black/5 text-[#1A1A1A]" 
                            onClick={() => cameraInputRef.current?.click()}
                          >
                            <Camera className="w-5 h-5 mr-4 text-black/60" /> Take a Picture
                          </Button>
                          <Button 
                            variant="ghost" 
                            className="h-14 justify-start font-sans text-base rounded-xl hover:bg-black/5 text-[#1A1A1A]" 
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <ImageIcon className="w-5 h-5 mr-4 text-black/60" /> Upload Image or PDF
                          </Button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>

                <input 
                  type="file" 
                  accept="image/*,application/pdf" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setShowMenu(false);
                  }}
                />
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  ref={cameraInputRef} 
                  className="hidden" 
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setShowMenu(false);
                  }}
                />

                <Button 
                  className="w-full h-12 text-base font-montserrat font-bold bg-[#1A1A1A] hover:bg-black text-white rounded-xl shadow-md transition-all duration-300 active:scale-[0.98] group relative overflow-hidden"
                  onClick={handleCapture}
                >
                  <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                  Process <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="relative mb-8">
                <motion.div 
                  className="w-20 h-20 border border-black/5 rounded-full"
                  animate={{ scale: [1, 1.05, 1], opacity: [0.1, 0.2, 0.1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div 
                  className="absolute inset-0 border-t-2 border-black rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
                <Search className="absolute inset-0 m-auto w-6 h-6 text-black/40" />
              </div>
              <h2 className="text-2xl font-montserrat font-bold text-[#1A1A1A] mb-2">Processing</h2>
              <p className="text-black/60 text-sm max-w-[200px] mx-auto">
                Extracting details...
              </p>
            </motion.div>
          )}

          {step === "review" && record && (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
              className="space-y-12"
            >
              {record.status === "Invalid" ? (
                <motion.div 
                  initial={{ scale: 0.98, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-red-500/5 border border-red-500/10 rounded-xl p-4"
                >
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <h3 className="font-montserrat font-semibold text-[#1A1A1A]">Validation Failed</h3>
                      <p className="text-black/60 text-sm">
                        Please check missing or unclear details.
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="flex items-center justify-between border-b border-black/5 pb-4">
                  <div>
                    <h2 className="text-2xl font-montserrat font-bold text-[#1A1A1A]">Review Details</h2>
                  </div>
                  <Badge className="px-3 py-1 text-[10px] font-bold tracking-widest uppercase bg-black/5 text-black/60 border-black/10">
                    Ready
                  </Badge>
                </div>
              )}

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className={`text-[10px] uppercase tracking-[0.2em] font-bold ${!record.vendor ? 'text-red-500' : 'text-black/40'}`}>
                      Vendor {!record.vendor && "(Required)"}
                    </Label>
                    <Input 
                      value={record.vendor} 
                      onChange={(e) => setRecord({...record, vendor: e.target.value})}
                      className={`bg-white/40 border-black/5 text-[#1A1A1A] h-11 px-4 rounded-xl focus-visible:ring-black/20 ${!record.vendor ? 'border-red-500/20' : ''}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className={`text-[10px] uppercase tracking-[0.2em] font-bold ${(!record.amount || parseFloat(record.amount) <= 0) ? 'text-red-500' : 'text-black/40'}`}>
                      Amount {!record.amount && "(Required)"}
                    </Label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40">$</span>
                      <Input 
                        value={record.amount} 
                        onChange={(e) => setRecord({...record, amount: e.target.value})}
                        className={`bg-white/40 border-black/5 text-[#1A1A1A] h-11 pl-8 pr-4 rounded-xl font-mono focus-visible:ring-black/20 ${(!record.amount || parseFloat(record.amount) <= 0) ? 'border-red-500/20' : ''}`}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className={`text-[10px] uppercase tracking-[0.2em] font-bold ${!record.invoiceDate ? 'text-red-500' : 'text-black/40'}`}>
                      Date {!record.invoiceDate && "(Required)"}
                    </Label>
                    <Input 
                      type="date"
                      value={record.invoiceDate} 
                      onChange={(e) => setRecord({...record, invoiceDate: e.target.value})}
                      className={`bg-white/40 border-black/5 text-[#1A1A1A] h-11 px-4 rounded-xl focus-visible:ring-black/20 ${!record.invoiceDate ? 'border-red-500/20' : ''}`}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1 space-y-2">
                      <Label className="text-[10px] uppercase tracking-[0.2em] font-bold text-black/40">Type</Label>
                      <Select 
                        value={record.captureType} 
                        onValueChange={(v) => setRecord({...record, captureType: v as CaptureType})}
                      >
                        <SelectTrigger className="bg-white/40 border-black/5 text-[#1A1A1A] h-11 px-4 rounded-xl focus:ring-black/20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-black/5 text-[#1A1A1A]">
                          <SelectItem value="Invoice">Invoice</SelectItem>
                          <SelectItem value="Receipt">Receipt</SelectItem>
                          <SelectItem value="Issue">Issue</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Label className="text-[10px] uppercase tracking-[0.2em] font-bold text-black/40">Route</Label>
                      <Select 
                        value={record.routeTo} 
                        onValueChange={(v) => setRecord({...record, routeTo: v})}
                      >
                        <SelectTrigger className="bg-white/40 border-black/5 text-[#1A1A1A] h-11 px-4 rounded-xl focus:ring-black/20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-black/5 text-[#1A1A1A]">
                          <SelectItem value="Google Sheets Only">Sheets Only</SelectItem>
                          <SelectItem value="Finance">Finance</SelectItem>
                          <SelectItem value="Operations">Operations</SelectItem>
                          <SelectItem value="HR">HR</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className={`text-[10px] uppercase tracking-[0.2em] font-bold ${record.status === "Invalid" ? 'text-red-500' : 'text-black/40'}`}>
                      Exception
                    </Label>
                    <Select 
                      value={record.exceptionType || ""} 
                      onValueChange={(v) => setRecord({...record, exceptionType: v as ExceptionType})}
                    >
                      <SelectTrigger className={`bg-white/40 border-black/5 text-[#1A1A1A] h-11 px-4 rounded-xl focus:ring-black/20 ${record.status === "Invalid" ? 'border-red-500/10' : ''}`}>
                        <SelectValue placeholder="No exceptions detected" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-black/5 text-[#1A1A1A]">
                        <SelectItem value="Price Mismatch">Price Mismatch</SelectItem>
                        <SelectItem value="Duplicate">Duplicate</SelectItem>
                        <SelectItem value="Missing Information">Missing Information</SelectItem>
                        <SelectItem value="Unclear Document">Unclear Document</SelectItem>
                        <SelectItem value="Needs Review">Needs Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Textarea 
                  value={record.userNotes} 
                  onChange={(e) => setRecord({...record, userNotes: e.target.value})}
                  placeholder="Notes..."
                  className="bg-white/40 border-black/5 text-[#1A1A1A] min-h-[80px] p-4 rounded-xl focus-visible:ring-black/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 pt-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-[0.2em] font-bold text-black/40 flex items-center gap-2">
                    <Info className="w-3 h-3" /> Notes
                  </Label>
                  <div className="text-xs text-black/60 bg-white/40 p-4 rounded-xl border border-black/5 italic">
                    {record.processingNotes}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-6">
                {record.status === "Invalid" ? (
                  <Button 
                    className="w-full h-12 text-base font-montserrat font-bold bg-[#1A1A1A] hover:bg-black text-white rounded-xl shadow-sm"
                    onClick={handleCorrection}
                  >
                    Re-Validate <Edit3 className="ml-2 w-4 h-4" />
                  </Button>
                ) : (
                  <Button 
                    className="w-full h-12 text-base font-montserrat font-bold bg-[#1A1A1A] hover:bg-black text-white rounded-xl shadow-sm"
                    onClick={handleFinalSubmit}
                  >
                    Confirm <Database className="ml-2 w-4 h-4" />
                  </Button>
                )}
                <Button variant="outline" className="w-full h-12 text-sm font-sans border-black/10 text-black/60 hover:bg-black/5 rounded-xl" onClick={reset}>
                  <RefreshCcw className="mr-2 w-4 h-4" /> Start Over
                </Button>
              </div>
            </motion.div>
          )}

          {step === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <motion.div 
                className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6 shadow-sm"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12 }}
              >
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </motion.div>
              <h2 className="text-2xl font-montserrat font-bold text-[#1A1A1A] mb-3">Saved</h2>
              <p className="text-black/60 text-sm max-w-[250px] mb-8">
                Line item synced to Google Sheets. 
              </p>
              <Button size="lg" className="w-full h-12 text-base font-montserrat font-bold bg-[#1A1A1A] hover:bg-black text-white rounded-xl shadow-sm" onClick={reset}>
                Done <Plus className="ml-2 w-4 h-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <Toaster position="top-center" />
    </div>
  );
}
