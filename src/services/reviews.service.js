const { reviews } = require('../db/procedures');
const {
  BadRequestError,
  NotFoundError,
  sendSuccess,
  asyncHandler,
} = require('../utils/apiResponse');

const createReview = asyncHandler(async (req, res) => {
  const customerId = req.user.id;
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new BadRequestError('Rating must be between 1 and 5.');
  }

  const result = await reviews.create(customerId, rating, comment);
  return sendSuccess(res, result, 'Review submitted successfully.', 201);
});

const getAllReviews = asyncHandler(async (req, res) => {
  const allReviews = await reviews.getAll();
  
  // If no auth token or user is customer, return only published reviews
  const isStaffOrAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'staff');
  
  if (isStaffOrAdmin) {
    return sendSuccess(res, allReviews);
  } else {
    // Only return published reviews, and filter out sensitive info if necessary
    const published = allReviews.filter(r => r.is_published);
    return sendSuccess(res, published);
  }
});

const getMyReviews = asyncHandler(async (req, res) => {
  const customerId = req.user.id;
  const myReviews = await reviews.getForCustomer(customerId);
  return sendSuccess(res, myReviews);
});

const toggleVisibility = asyncHandler(async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  if (isNaN(reviewId)) {
    throw new BadRequestError('Invalid review ID.');
  }
  const result = await reviews.toggleVisibility(reviewId);
  return sendSuccess(res, result, 'Review visibility toggled.');
});

module.exports = {
  createReview,
  getAllReviews,
  getMyReviews,
  toggleVisibility
};
