module.exports = function(crowi, app) {
  // var debug = require('debug')('growi:routes:search')
  const Page = crowi.model('Page');
  const ApiResponse = require('../util/apiResponse');
  const ApiPaginate = require('../util/apiPaginate');

  const actions = {};
  const api = {};

  actions.searchPage = function(req, res) {
    const keyword = req.query.q || null;
    const search = crowi.getSearcher();
    if (!search) {
      return res.json(ApiResponse.error('Configuration of ELASTICSEARCH_URI is required.'));
    }

    return res.render('search', {
      q: keyword,
    });
  };

  /**
   * @api {get} /search search page
   * @apiName Search
   * @apiGroup Search
   *
   * @apiParam {String} q keyword
   * @apiParam {String} path
   * @apiParam {String} offset
   * @apiParam {String} limit
   */
  api.search = async function(req, res) {
    const user = req.user;
    const { q: keyword = null, type = null } = req.query;
    let paginateOpts;

    try {
      paginateOpts = ApiPaginate.parseOptionsForElasticSearch(req.query);
    }
    catch (e) {
      res.json(ApiResponse.error(e));
    }

    if (keyword === null || keyword === '') {
      return res.json(ApiResponse.error('keyword should not empty.'));
    }

    const search = crowi.getSearcher();
    if (!search) {
      return res.json(ApiResponse.error('Configuration of ELASTICSEARCH_URI is required.'));
    }

    let userGroups = [];
    if (user != null) {
      const UserGroupRelation = crowi.model('UserGroupRelation');
      userGroups = await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user);
    }

    const searchOpts = { ...paginateOpts, type };

    const result = {};
    try {
      const esResult = await search.searchKeyword(keyword, user, userGroups, searchOpts);

      // create score map for sorting
      // key: id , value: score
      const scoreMap = {};
      for (const esPage of esResult.data) {
        scoreMap[esPage._id] = esPage._score;
      }

      // filter by tag
      if (esResult.tagFilter.length > 0) {
        // get related page ids to each tag
        const pageIdLists = await Page.findByTagLists(esResult.tagFilter[0].tags);

        if (pageIdLists.length > 0) {
          esResult.data = esResult.data.filter((resultPage) => {
            return pageIdLists.every((pageIdList) => { // return true if this page related to all tags
              if (pageIdList.length > 0) {
                return pageIdList.includes(resultPage._id);
              }
              return false;
            });
          });
        }
        else {
          esResult.data = [];
        }
      }
      const findResult = await Page.findListByPageIds(esResult.data);

      result.meta = esResult.meta;
      result.totalCount = findResult.totalCount;
      result.data = findResult.pages
        .map((page) => {
          page.bookmarkCount = (page._source && page._source.bookmark_count) || 0;
          return page;
        })
        .sort((page1, page2) => {
          // note: this do not consider NaN
          return scoreMap[page2._id] - scoreMap[page1._id];
        });
    }
    catch (err) {
      return res.json(ApiResponse.error(err));
    }

    return res.json(ApiResponse.success(result));
  };

  actions.api = api;
  return actions;
};
