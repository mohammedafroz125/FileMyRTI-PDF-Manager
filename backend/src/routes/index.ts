import { Router } from "express";
import { getHealthStatus } from "../controllers/health-controller";
import { handleOptimizationRequest } from "../controllers/optimization-controller";
import { handleMobileUploadExpress } from "../controllers/mobile-upload-controller";
import { uploadMiddleware } from "../middleware/upload-middleware";

const router = Router();

// GET /api/health -> Health Check
router.get("/health", getHealthStatus);

// POST /api/optimize -> PDF / Document Optimization
router.post("/optimize", uploadMiddleware.any(), handleOptimizationRequest);

// POST /api/convert-doc -> DOC / DOCX Conversion & Optimization
router.post("/convert-doc", uploadMiddleware.any(), handleOptimizationRequest);

// POST Mobile Upload endpoints
router.post("/upload-mobile", uploadMiddleware.any(), handleMobileUploadExpress);
router.post("/mobile-upload", uploadMiddleware.any(), handleMobileUploadExpress);
router.post("/m/upload/:token?", uploadMiddleware.any(), handleMobileUploadExpress);
router.post("/api/m/upload/:token?", uploadMiddleware.any(), handleMobileUploadExpress);

export default router;
