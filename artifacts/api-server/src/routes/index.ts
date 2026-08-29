import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nurseryRouter from "./nursery";
import applicationsRouter from "./applications";
import storageRouter from "./storage";
import nurseryOperationsRouter from "./nurseryOperations";
import task16OperationsRouter from "./task16Operations";
import siteGalleryRouter from "./siteGallery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(siteGalleryRouter);
router.use(applicationsRouter);
router.use(storageRouter);
router.use((req, res, next) => {
  const isPublicStaffAccountRoute = req.method === "POST" && (
    /^\/staff\/\d+\/account\/verify$/.test(req.path) ||
    req.path === "/staff/password-reset/request" ||
    req.path === "/staff/password-reset/complete"
  );
  if (isPublicStaffAccountRoute) {
    nurseryRouter(req, res, next);
    return;
  }
  next();
});
router.use(nurseryOperationsRouter);
router.use(task16OperationsRouter);
router.use(nurseryRouter);

export default router;
