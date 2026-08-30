import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nurseryRouter from "./nursery";
import applicationsRouter from "./applications";
import storageRouter from "./storage";
import nurseryOperationsRouter from "./nurseryOperations";
import task16OperationsRouter from "./task16Operations";
import siteGalleryRouter from "./siteGallery";
import phoneAuthRouter from "./phoneAuth";
import publicRegistrationRouter from "./publicRegistration";

const router: IRouter = Router();

router.use(healthRouter);
router.use(phoneAuthRouter);
router.use(publicRegistrationRouter);
router.use(siteGalleryRouter);
router.use(applicationsRouter);
router.use(storageRouter);
router.use((req, res, next) => {
  const isPublicStaffAccountRoute = req.method === "POST" && (
    req.path.startsWith("/auth/registration/") ||
    req.path.startsWith("/auth/password-reset/")
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
